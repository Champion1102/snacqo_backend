import crypto from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import Razorpay from 'razorpay';
import { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { uploadImage, uploadVideo } from '../services/cloudinary.js';
import { formatDateTimeIST } from '../utils/date.js';
import { findCart, getOrCreateCart } from './cart.js';

const router = Router();
const prisma = new PrismaClient();

const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
const razorpay =
  razorpayKeyId && razorpayKeySecret
    ? new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret })
    : null;

const CART_COOKIE = 'cart_session';

// Tiered shipping (standard delivery only): <₹200 → ₹50, ₹200–₹498 → ₹100, ≥₹499 → free. Campus is always free.
const FREE_SHIPPING_THRESHOLD_PAISE = 49_900;   // ₹499
const SHIPPING_LOW_THRESHOLD_PAISE = 20_000;   // ₹200
const SHIPPING_BELOW_200_PAISE = 5_000;        // ₹50
const SHIPPING_200_TO_499_PAISE = 10_000;      // ₹100

function getStandardShippingPaise(subtotalPaise: number): number {
  if (subtotalPaise >= FREE_SHIPPING_THRESHOLD_PAISE) return 0;
  if (subtotalPaise < SHIPPING_LOW_THRESHOLD_PAISE) return SHIPPING_BELOW_200_PAISE;
  return SHIPPING_200_TO_499_PAISE;
}

const reviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB for video
  fileFilter: (_req, file, cb) => {
    const imageAllowed = /^image\/(jpeg|jpg|png|gif|webp)$/i;
    const videoAllowed = /^video\/(mp4|webm|quicktime)$/i;
    if (imageAllowed.test(file.mimetype) || videoAllowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images (jpeg, png, gif, webp) and videos (mp4, webm) are allowed.'));
  },
});

function generateOrderNumber(): string {
  const part = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SNQ-${part}-${rand}`;
}

type CartItemWithVariant = {
  id: string;
  variantId: string;
  quantity: number;
  variant: {
    id: string;
    name: string;
    price: number;
    product: { name: string };
  };
};

async function validateCoupon(
  prisma: PrismaClient,
  code: string,
  subtotalPaise: number,
  options: { isCampusOrder?: boolean; campusId?: string | null } = {}
): Promise<{ valid: true; discountAmount: number; freeShipping: boolean } | { valid: false; message: string }> {
  const { isCampusOrder = false, campusId = null } = options;
  const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
  if (!coupon || !coupon.isActive) return { valid: false, message: 'Invalid or inactive coupon.' };
  const now = new Date();
  if (now < coupon.validFrom) return { valid: false, message: `Coupon not yet valid. Valid from ${formatDateTimeIST(coupon.validFrom)}.` };
  if (now > coupon.validTo) return { valid: false, message: `Coupon has expired. It was valid until ${formatDateTimeIST(coupon.validTo)}.` };
  if (coupon.minOrderAmount != null && subtotalPaise < coupon.minOrderAmount)
    return { valid: false, message: 'Minimum order amount not met.' };
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses)
    return { valid: false, message: 'Coupon usage limit reached.' };
  if (coupon.campusOnly) {
    if (!isCampusOrder)
      return { valid: false, message: 'This coupon is only valid for campus delivery orders.' };
    const allowedIds = coupon.allowedCampusIds ?? [];
    if (allowedIds.length > 0 && (!campusId || !allowedIds.includes(campusId)))
      return { valid: false, message: 'This coupon is not valid for the selected campus.' };
  }
  const freeShipping = coupon.type === 'FREE_SHIPPING';
  const discountAmount =
    freeShipping
      ? 0
      : coupon.type === 'PERCENT'
        ? Math.floor((subtotalPaise * coupon.value) / 100)
        : Math.min(coupon.value, subtotalPaise);
  return { valid: true, discountAmount, freeShipping };
}

const orderInclude = {
  items: {
    include: {
      variant: {
        select: {
          id: true,
          name: true,
          sku: true,
          price: true,
          product: {
            select: {
              id: true,
              slug: true,
              name: true,
              images: {
                orderBy: { sortOrder: 'asc' },
                take: 1,
                select: { url: true },
              },
            },
          },
        },
      },
    },
  },
  campus: { select: { id: true, name: true, line1: true, city: true, state: true, pincode: true } },
};

// POST /orders – create order from cart (optional auth for guest checkout)
router.post('/', optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    const sessionId = (req.cookies as { [CART_COOKIE]?: string })?.[CART_COOKIE] ?? null;
    const cart = await findCart(prisma, userId, sessionId);

    if (!cart || !cart.items.length) {
      res.status(400).json({ error: 'Cart is empty. Add items before placing an order.' });
      return;
    }

    const body = req.body as {
      email?: string;
      deliveryType?: string;
      campusId?: string;
      shippingName?: string;
      shippingPhone?: string;
      shippingLine1?: string;
      shippingLine2?: string;
      shippingCity?: string;
      shippingState?: string;
      shippingPincode?: string;
      couponCode?: string;
      couponCodes?: string[];
    };

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined;
    const deliveryTypeRaw = typeof body.deliveryType === 'string' ? body.deliveryType.trim().toUpperCase() : 'STANDARD';
    const deliveryType = deliveryTypeRaw === 'CAMPUS' ? 'CAMPUS' : 'STANDARD';
    const campusId = typeof body.campusId === 'string' ? body.campusId.trim() || null : null;
    const shippingName = typeof body.shippingName === 'string' ? body.shippingName.trim() : undefined;
    const shippingPhone = typeof body.shippingPhone === 'string' ? body.shippingPhone.trim() : undefined;
    const shippingLine1 = typeof body.shippingLine1 === 'string' ? body.shippingLine1.trim() : undefined;
    const shippingLine2 = typeof body.shippingLine2 === 'string' ? body.shippingLine2.trim() : null;
    const shippingCity = typeof body.shippingCity === 'string' ? body.shippingCity.trim() : undefined;
    const shippingState = typeof body.shippingState === 'string' ? body.shippingState.trim() : undefined;
    const shippingPincode = typeof body.shippingPincode === 'string' ? body.shippingPincode.trim() : undefined;
    const couponCodesRaw = Array.isArray(body.couponCodes) ? body.couponCodes : [];
    const couponCodeSingle = typeof body.couponCode === 'string' ? body.couponCode.trim() : undefined;
    const couponCodes = couponCodesRaw.length > 0
      ? couponCodesRaw.map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean)
      : (couponCodeSingle ? [couponCodeSingle] : []);

    if (!email) {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }
    if (deliveryType === 'CAMPUS' && !campusId) {
      res.status(400).json({ error: 'Campus is required for campus delivery.' });
      return;
    }

    let finalName: string;
    let finalPhone: string;
    let finalLine1: string;
    let finalLine2: string | null;
    let finalCity: string;
    let finalState: string;
    let finalPincode: string;
    const isCampusOrder = Boolean(deliveryType === 'CAMPUS' && campusId);

    if (isCampusOrder && campusId) {
      const campus = await prisma.campus.findFirst({
        where: { id: campusId, isActive: true },
      });
      if (!campus) {
        res.status(400).json({ error: 'Invalid or inactive campus selected.' });
        return;
      }
      if (!shippingName || !shippingPhone) {
        res.status(400).json({ error: 'Name and phone are required for campus delivery.' });
        return;
      }
      finalName = shippingName;
      finalPhone = shippingPhone;
      finalLine1 = campus.line1;
      finalLine2 = campus.line2;
      finalCity = campus.city;
      finalState = campus.state;
      finalPincode = campus.pincode;
    } else {
      if (!shippingName || !shippingPhone || !shippingLine1 || !shippingCity || !shippingState || !shippingPincode) {
        res.status(400).json({
          error: 'Missing required fields: email, shippingName, shippingPhone, shippingLine1, shippingCity, shippingState, shippingPincode.',
        });
        return;
      }
      finalName = shippingName;
      finalPhone = shippingPhone;
      finalLine1 = shippingLine1;
      finalLine2 = shippingLine2;
      finalCity = shippingCity;
      finalState = shippingState;
      finalPincode = shippingPincode;
    }

    const items = cart.items as unknown as CartItemWithVariant[];
    let subtotal = 0;
    for (const item of items) {
      subtotal += item.variant.price * item.quantity;
    }

    const settingRow = await prisma.setting.findUnique({ where: { key: 'allow_multiple_coupons' } });
    const allowMultipleCoupons = settingRow?.value === 'true';

    if (couponCodes.length > 1 && !allowMultipleCoupons) {
      res.status(400).json({ error: 'Multiple coupon codes are not allowed.' });
      return;
    }

    const codesToApply = allowMultipleCoupons ? [...new Set(couponCodes.map((c) => c.toUpperCase()))] : (couponCodes.length > 0 ? [couponCodes[0].toUpperCase()] : []);

    let discountAmount = 0;
    let freeShipping = false;
    for (const code of codesToApply) {
      const result = await validateCoupon(prisma, code, subtotal, {
        isCampusOrder,
        campusId: campusId ?? undefined,
      });
      if (!result.valid) {
        res.status(400).json({ error: result.message });
        return;
      }
      discountAmount += result.discountAmount;
      freeShipping = freeShipping || result.freeShipping;
    }

    const shippingAmount = freeShipping || isCampusOrder ? 0 : getStandardShippingPaise(subtotal);
    const total = Math.max(0, subtotal - discountAmount + shippingAmount);
    const orderNumber = generateOrderNumber();
    const couponCodeStored = codesToApply.length > 0 ? codesToApply.join(',') : undefined;

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          userId: userId ?? undefined,
          email,
          status: 'PENDING',
          deliveryType,
          campusId: isCampusOrder ? campusId : undefined,
          subtotal,
          shippingAmount,
          discountAmount,
          total,
          currency: 'INR',
          couponCode: couponCodeStored,
          shippingName: finalName,
          shippingPhone: finalPhone,
          shippingLine1: finalLine1,
          shippingLine2: finalLine2,
          shippingCity: finalCity,
          shippingState: finalState,
          shippingPincode: finalPincode,
        },
      });

      for (const item of items) {
        const unitPrice = item.variant.price;
        await tx.orderItem.create({
          data: {
            orderId: newOrder.id,
            variantId: item.variantId,
            productName: item.variant.product.name,
            variantName: item.variant.name,
            quantity: item.quantity,
            price: unitPrice,
            total: unitPrice * item.quantity,
          },
        });
      }

      for (const code of codesToApply) {
        await tx.coupon.update({
          where: { code },
          data: { usedCount: { increment: 1 } },
        });
      }

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return newOrder;
    });

    const orderWithItems = await prisma.order.findUnique({
      where: { id: order.id },
      include: orderInclude,
    });

    res.status(201).json({
      order: orderWithItems,
      razorpayOrderId: null, // To be set when payment flow is implemented
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /orders – list orders for current user (auth), with items and product images for thumbnails
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        _count: { select: { items: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            productName: true,
            variantName: true,
            variant: {
              select: {
                id: true,
                name: true,
                product: {
                  select: {
                    id: true,
                    slug: true,
                    name: true,
                    images: {
                      orderBy: { sortOrder: 'asc' },
                      take: 1,
                      select: { url: true },
                    },
                  },
                },
              },
            },
          },
        },
        review: { select: { id: true } },
      },
    });
    res.json({ orders });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /orders/:orderId/create-payment-order – create Razorpay order for payment
router.post('/:orderId/create-payment-order', optionalAuth, async (req, res) => {
  try {
    if (!razorpay || !razorpayKeyId) {
      res.status(503).json({ error: 'Payment is not configured.' });
      return;
    }
    const orderId = req.params.orderId;
    if (!orderId) {
      res.status(400).json({ error: 'Order ID is required.' });
      return;
    }
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, total: true, currency: true, status: true },
    });
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (order.status !== 'PENDING') {
      res.status(400).json({ error: 'Order is not pending payment.' });
      return;
    }
    const rzpOrder = await new Promise<{ id: string }>((resolve, reject) => {
      razorpay.orders.create(
        {
          amount: order.total,
          currency: order.currency,
          receipt: order.orderNumber,
        },
        (err, data) => {
          if (err) reject(err);
          else resolve(data as { id: string });
        }
      );
    });
    await prisma.order.update({
      where: { id: orderId },
      data: { razorpayOrderId: rzpOrder.id },
    });
    res.json({
      razorpayOrderId: rzpOrder.id,
      key: razorpayKeyId,
      amount: order.total,
      currency: order.currency,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not create payment order.' });
  }
});

// POST /orders/:orderId/verify-payment – verify Razorpay signature, fetch payment status from Razorpay, store it; set order to PROCESSING only if payment captured
router.post('/:orderId/verify-payment', optionalAuth, async (req, res) => {
  try {
    if (!razorpayKeySecret || !razorpay) {
      res.status(503).json({ error: 'Payment is not configured.' });
      return;
    }
    const orderId = req.params.orderId;
    const body = req.body as {
      razorpay_payment_id?: string;
      razorpay_order_id?: string;
      razorpay_signature?: string;
    };
    const razorpayPaymentId = typeof body.razorpay_payment_id === 'string' ? body.razorpay_payment_id.trim() : undefined;
    const razorpayOrderId = typeof body.razorpay_order_id === 'string' ? body.razorpay_order_id.trim() : undefined;
    const razorpaySignature = typeof body.razorpay_signature === 'string' ? body.razorpay_signature.trim() : undefined;

    if (!orderId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
      res.status(400).json({ error: 'Missing payment verification details.' });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (order.status !== 'PENDING') {
      res.status(400).json({ error: 'Order is not pending payment.' });
      return;
    }

    const expectedSignature = crypto
      .createHmac('sha256', razorpayKeySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
    if (expectedSignature !== razorpaySignature) {
      res.status(400).json({ error: 'Invalid payment signature.' });
      return;
    }

    // Fetch payment from Razorpay to get actual status (captured / failed / etc.)
    const payment = await razorpay.payments.fetch(razorpayPaymentId);
    const razorpayPaymentStatus = payment.status as string;

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: razorpayPaymentStatus === 'captured' ? 'PROCESSING' : 'PENDING',
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        razorpayPaymentStatus,
      },
    });

    const orderWithItems = await prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
    res.json({ success: true, order: orderWithItems });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Payment verification failed.' });
  }
});

// DELETE /orders/:orderId – cancel a PENDING order; restore cart and revert coupon
router.delete('/:orderId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const orderId = req.params.orderId;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, couponCode: true, items: { select: { variantId: true, quantity: true } } },
    });
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (order.status !== 'PENDING') {
      res.status(400).json({ error: 'Only pending orders can be cancelled.' });
      return;
    }

    const { id: cartId } = await getOrCreateCart(prisma, req, res);

    await prisma.$transaction(async (tx) => {
      const items = order.items as Array<{ variantId: string; quantity: number }>;
      for (const item of items) {
        const existing = await tx.cartItem.findUnique({
          where: { cartId_variantId: { cartId, variantId: item.variantId } },
        });
        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + item.quantity },
          });
        } else {
          await tx.cartItem.create({
            data: { cartId, variantId: item.variantId, quantity: item.quantity },
          });
        }
      }
      if (order.couponCode) {
        const codes = order.couponCode.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
        for (const code of codes) {
          await tx.coupon.updateMany({
            where: { code },
            data: { usedCount: { decrement: 1 } },
          });
        }
      }
      await tx.order.delete({ where: { id: orderId } });
    });

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not cancel order.' });
  }
});

// GET /orders/:orderId/review – get review for order (auth, order must be delivered)
router.get('/:orderId/review', requireAuth, async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const userId = req.user!.id;
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId, status: 'DELIVERED' },
      select: { id: true },
    });
    if (!order) {
      res.status(404).json({ error: 'Order not found or not delivered.' });
      return;
    }
    const review = await prisma.orderReview.findUnique({
      where: { orderId },
      select: {
        id: true,
        rating: true,
        text: true,
        imageUrls: true,
        videoUrl: true,
        reviewerFirstName: true,
        reviewerLastName: true,
        createdAt: true,
      },
    });
    res.json({ review: review ?? null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /orders/:orderId/review – submit review (auth, multipart: text, images[], video)
router.post(
  '/:orderId/review',
  requireAuth,
  reviewUpload.fields([
    { name: 'images', maxCount: 5 },
    { name: 'video', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const orderId = req.params.orderId;
      const userId = req.user!.id;
      const order = await prisma.order.findFirst({
        where: { id: orderId, userId, status: 'DELIVERED' },
        select: { id: true },
      });
      if (!order) {
        res.status(404).json({ error: 'Order not found or not delivered.' });
        return;
      }
      const existing = await prisma.orderReview.findUnique({ where: { orderId } });
      if (existing) {
        res.status(400).json({ error: 'You have already submitted a review for this order.' });
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      const reviewerFirstName = user?.firstName ?? null;
      const reviewerLastName = user?.lastName ?? null;

      const text = typeof req.body.text === 'string' ? req.body.text.trim() : null;
      const ratingRaw = req.body.rating;
      const parsed = ratingRaw !== undefined && ratingRaw !== '' ? parseInt(String(ratingRaw), 10) : NaN;
      const ratingNum = Number.isNaN(parsed) ? null : Math.min(5, Math.max(1, parsed));

      const files = req.files as { images?: Express.Multer.File[]; video?: Express.Multer.File[] } | undefined;
      const imageUrls: string[] = [];
      if (files?.images?.length) {
        for (const file of files.images) {
          const isImage = /^image\//i.test(file.mimetype);
          if (isImage) {
            const { url } = await uploadImage(file.buffer, { folder: 'snacqo/reviews' });
            imageUrls.push(url);
          }
        }
      }
      let videoUrl: string | null = null;
      if (files?.video?.[0]) {
        const file = files.video[0];
        const { url } = await uploadVideo(file.buffer, { folder: 'snacqo/reviews' });
        videoUrl = url;
      }
      await prisma.orderReview.create({
        data: {
          orderId,
          userId,
          reviewerFirstName,
          reviewerLastName,
          rating: ratingNum,
          text: text || null,
          imageUrls,
          videoUrl,
        },
      });
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to submit review.' });
    }
  }
);

// GET /orders/:id – order detail + items (auth, or guest by email + orderNumber)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : undefined;
    const orderNumber = typeof req.query.orderNumber === 'string' ? req.query.orderNumber.trim() : undefined;

    const order = await prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    });

    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const isOwner = req.user && order.userId === req.user.id;
    const isGuestLookup = email && orderNumber && order.email === email && order.orderNumber === orderNumber;

    if (!isOwner && !isGuestLookup) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    res.json({ order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
