import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { type PrismaClient } from '@prisma/client';
import { optionalAuth } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

// Tiered shipping thresholds (paise). Single source of truth — imported by orders.ts via the summary route.
export const FREE_SHIPPING_THRESHOLD_PAISE = 49_900;  // ₹499
export const SHIPPING_LOW_THRESHOLD_PAISE = 20_000;   // ₹200
export const SHIPPING_BELOW_200_PAISE = 5_000;        // ₹50
export const SHIPPING_200_TO_499_PAISE = 10_000;      // ₹100

export function getStandardShippingPaise(subtotalPaise: number): number {
  if (subtotalPaise >= FREE_SHIPPING_THRESHOLD_PAISE) return 0;
  if (subtotalPaise < SHIPPING_LOW_THRESHOLD_PAISE) return SHIPPING_BELOW_200_PAISE;
  return SHIPPING_200_TO_499_PAISE;
}

const router = Router();

const CART_COOKIE = 'cart_session';
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const cartItemInclude = {
  variant: {
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      compareAtPrice: true,
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          images: { orderBy: { sortOrder: 'asc' as const }, take: 1, select: { url: true } },
        },
      },
    },
  },
};

type CartWithItems = Awaited<
  ReturnType<
    typeof prisma.cart.findFirst<{ include: { items: { include: typeof cartItemInclude } } }>
  >
>;

/**
 * Merges session (guest) cart into the user's cart and deletes the session cart.
 * Strategy: guest cart wins — the user's active shopping intent is always the freshest
 * signal. For items in both carts, guest quantity replaces the old saved quantity.
 * Items that exist only in the old user cart are kept (the user may still want them).
 */
async function mergeSessionCartIntoUserCart(
  prisma: PrismaClient,
  userCart: NonNullable<CartWithItems>,
  sessionCart: NonNullable<CartWithItems>
): Promise<NonNullable<CartWithItems>> {
  const sessionItems = sessionCart.items as Array<{ variantId: string; quantity: number }>;
  if (sessionItems.length === 0) return userCart;

  await prisma.$transaction(async (tx) => {
    for (const item of sessionItems) {
      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
      });
      if (existing) {
        // Guest quantity wins — overwrite, do not sum.
        // This prevents phantom items from accumulating across login/logout cycles.
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: item.quantity },
        });
      } else {
        await tx.cartItem.create({
          data: { cartId: userCart.id, variantId: item.variantId, quantity: item.quantity },
        });
      }
    }
    await tx.cartItem.deleteMany({ where: { cartId: sessionCart.id } });
    try {
      await tx.cart.delete({ where: { id: sessionCart.id } });
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2025') {
        // Session cart already deleted (e.g. by a concurrent request); merge is still valid
        return;
      }
      throw e;
    }
  });

  const merged = await prisma.cart.findFirst({
    where: { id: userCart.id },
    include: { items: { include: cartItemInclude } },
  });
  return merged as NonNullable<CartWithItems>;
}

export async function findCart(prisma: PrismaClient, userId: string | null, sessionId: string | null) {
  let byUser: CartWithItems = null;
  let bySession: CartWithItems = null;
  if (userId) {
    byUser = await prisma.cart.findFirst({
      where: { userId },
      include: { items: { include: cartItemInclude } },
    });
  }
  if (sessionId) {
    bySession = await prisma.cart.findFirst({
      where: { sessionId },
      include: { items: { include: cartItemInclude } },
    });
  }

  // When user is logged in and session cart has items: merge into user cart, or assign session cart to user
  if (userId && bySession && bySession.items.length > 0) {
    if (byUser && byUser.id !== bySession.id) {
      return mergeSessionCartIntoUserCart(prisma, byUser, bySession);
    }
    if (!byUser) {
      // No user cart yet: assign session cart to user (userId, clear sessionId)
      await prisma.cart.update({
        where: { id: bySession.id },
        data: { userId, sessionId: null },
      });
      const assigned = await prisma.cart.findFirst({
        where: { id: bySession.id },
        include: { items: { include: cartItemInclude } },
      });
      return assigned as NonNullable<CartWithItems>;
    }
  }

  if (byUser) return byUser;
  if (bySession) return bySession;
  return null;
}

export async function getOrCreateCart(
  prisma: PrismaClient,
  req: Request,
  res: Response
): Promise<{ id: string; items: unknown[] }> {
  const userId = req.user?.id ?? null;
  const sessionId = (req.cookies as { [CART_COOKIE]?: string })?.[CART_COOKIE] ?? null;

  let cart = await findCart(prisma, userId, sessionId);
  if (cart) {
    return { id: cart.id, items: cart.items };
  }

  const newSessionId = sessionId ?? randomUUID();
  cart = await prisma.cart.create({
    data: {
      userId: userId ?? undefined,
      sessionId: userId ? undefined : newSessionId,
    },
    include: { items: { include: cartItemInclude } },
  });
  if (!userId) {
    res.cookie(CART_COOKIE, newSessionId, {
      httpOnly: true,
      maxAge: CART_COOKIE_MAX_AGE * 1000,
      sameSite: 'none',
      secure: true,
      path: '/',
    });
  }
  return { id: cart!.id, items: cart!.items };
}

function formatCart(cart: { id: string; items: unknown[] }) {
  return {
    cart: {
      id: cart.id,
      items: cart.items,
    },
  };
}

router.use(optionalAuth);

// GET /cart
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    const sessionId = (req.cookies as { [CART_COOKIE]?: string })?.[CART_COOKIE] ?? null;
    const cart = await findCart(prisma, userId, sessionId);
    if (!cart) {
      res.json({ cart: { id: null, items: [] } });
      return;
    }
    res.json(formatCart({ id: cart.id, items: cart.items }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /cart/summary – returns server-computed pricing breakdown for the current cart.
// Accepts optional query params: couponCodes (comma-separated), isCampusOrder, campusId.
// This is the single source of truth for all pricing shown on the checkout page —
// the frontend never computes shipping or discounts independently.
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    const sessionId = (req.cookies as { [CART_COOKIE]?: string })?.[CART_COOKIE] ?? null;
    const cart = await findCart(prisma, userId, sessionId);

    const items = (cart?.items ?? []) as Array<{ variantId: string; quantity: number; variant: { price: number } }>;
    let subtotal = 0;
    for (const item of items) {
      subtotal += item.variant.price * item.quantity;
    }

    // Parse optional coupon and delivery params from query
    const rawCoupons = typeof req.query.couponCodes === 'string' ? req.query.couponCodes : '';
    const couponCodes = rawCoupons
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const isCampusOrder = req.query.isCampusOrder === 'true';
    const campusId = typeof req.query.campusId === 'string' ? req.query.campusId.trim() || null : null;

    let discountAmount = 0;
    let freeShipping = false;
    const couponMessages: Array<{ code: string; message: string; valid: boolean }> = [];

    for (const code of couponCodes) {
      const coupon = await prisma.coupon.findUnique({ where: { code } });
      if (!coupon || !coupon.isActive) {
        couponMessages.push({ code, message: 'Invalid or inactive coupon.', valid: false });
        continue;
      }
      const now = new Date();
      if (now < coupon.validFrom || now > coupon.validTo) {
        couponMessages.push({ code, message: 'Coupon has expired.', valid: false });
        continue;
      }
      if (coupon.minOrderAmount != null && subtotal < coupon.minOrderAmount) {
        couponMessages.push({ code, message: 'Minimum order amount not met.', valid: false });
        continue;
      }
      if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
        couponMessages.push({ code, message: 'Coupon usage limit reached.', valid: false });
        continue;
      }
      if (coupon.campusOnly) {
        if (!isCampusOrder) {
          couponMessages.push({ code, message: 'This coupon is only valid for campus delivery orders.', valid: false });
          continue;
        }
        const allowedIds = coupon.allowedCampusIds ?? [];
        if (allowedIds.length > 0 && (!campusId || !allowedIds.includes(campusId))) {
          couponMessages.push({ code, message: 'This coupon is not valid for the selected campus.', valid: false });
          continue;
        }
      }
      const isFreeShipping = coupon.type === 'FREE_SHIPPING';
      const itemDiscount = isFreeShipping
        ? 0
        : coupon.type === 'PERCENT'
          ? Math.floor((subtotal * coupon.value) / 100)
          : Math.min(coupon.value, subtotal);
      discountAmount += itemDiscount;
      freeShipping = freeShipping || isFreeShipping;
      couponMessages.push({ code, message: 'Coupon applied.', valid: true });
    }

    const shippingAmount = freeShipping || isCampusOrder ? 0 : getStandardShippingPaise(subtotal);
    const total = Math.max(0, subtotal - discountAmount + shippingAmount);

    // Shipping tier thresholds for the frontend progress bar
    const nextFreeShippingAt = subtotal < FREE_SHIPPING_THRESHOLD_PAISE ? FREE_SHIPPING_THRESHOLD_PAISE : null;

    res.json({
      summary: {
        subtotal,
        shippingAmount,
        discountAmount,
        total,
        isFreeShipping: freeShipping || isCampusOrder,
        nextFreeShippingAt,
        couponMessages,
        itemCount: items.reduce((s, i) => s + i.quantity, 0),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /cart/items  { variantId, quantity }
router.post('/items', async (req, res) => {
  try {
    const body = req.body as { variantId?: string; quantity?: number };
    const variantId = typeof body.variantId === 'string' ? body.variantId.trim() : undefined;
    const quantity = typeof body.quantity === 'number' ? Math.max(1, Math.floor(body.quantity)) : 1;

    if (!variantId) {
      res.status(400).json({ error: 'variantId is required.' });
      return;
    }

    // Validate variant and get/create cart in parallel
    const [variant, { id: cartId }] = await Promise.all([
      prisma.productVariant.findUnique({ where: { id: variantId, isActive: true } }),
      getOrCreateCart(prisma, req, res),
    ]);

    if (!variant) {
      res.status(404).json({ error: 'Variant not found.' });
      return;
    }

    // Upsert: if item exists increment quantity, else create it — single DB round trip
    await prisma.$executeRaw`
      INSERT INTO "CartItem" ("id", "cartId", "variantId", "quantity", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${cartId}, ${variantId}, ${quantity}, now(), now())
      ON CONFLICT ("cartId", "variantId")
      DO UPDATE SET "quantity" = "CartItem"."quantity" + ${quantity}, "updatedAt" = now()
    `;

    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { items: { include: cartItemInclude } },
    });
    if (!cart) {
      res.status(500).json({ error: 'Something went wrong.' });
      return;
    }
    res.json(formatCart({ id: cart.id, items: cart.items }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// PATCH /cart/items/:variantId  { quantity }
router.patch('/items/:variantId', async (req, res) => {
  try {
    const variantId = req.params.variantId;
    const body = req.body as { quantity?: number };
    const quantity = typeof body.quantity === 'number' ? Math.max(0, Math.floor(body.quantity)) : undefined;

    if (!variantId) {
      res.status(400).json({ error: 'variantId is required.' });
      return;
    }

    const userId = req.user?.id ?? null;
    const sessionId = (req.cookies as { [CART_COOKIE]?: string })?.[CART_COOKIE] ?? null;
    const cart = await findCart(prisma, userId, sessionId);
    if (!cart) {
      res.json({ cart: { id: null, items: [] } });
      return;
    }

    const line = await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });
    if (!line) {
      res.status(404).json({ error: 'Item not in cart.' });
      return;
    }

    if (quantity === 0) {
      await prisma.cartItem.delete({ where: { id: line.id } });
    } else if (quantity !== undefined) {
      await prisma.cartItem.update({
        where: { id: line.id },
        data: { quantity },
      });
    }

    const updated = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: { items: { include: cartItemInclude } },
    });
    res.json(formatCart({ id: updated!.id, items: updated!.items }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DELETE /cart/items/:variantId
router.delete('/items/:variantId', async (req, res) => {
  try {
    const variantId = req.params.variantId;
    if (!variantId) {
      res.status(400).json({ error: 'variantId is required.' });
      return;
    }

    const userId = req.user?.id ?? null;
    const sessionId = (req.cookies as { [CART_COOKIE]?: string })?.[CART_COOKIE] ?? null;
    const cart = await findCart(prisma, userId, sessionId);
    if (!cart) {
      res.json({ cart: { id: null, items: [] } });
      return;
    }

    const line = await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });
    if (line) {
      await prisma.cartItem.delete({ where: { id: line.id } });
    }

    const updated = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: { items: { include: cartItemInclude } },
    });
    res.json(formatCart({ id: updated!.id, items: updated!.items }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
