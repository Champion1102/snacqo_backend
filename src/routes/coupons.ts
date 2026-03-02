import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { formatDateTimeIST } from '../utils/date.js';

const router = Router();
const prisma = new PrismaClient();

// POST /coupons/validate  { code, subtotal, isCampusOrder?, campusId? }  -> { valid, discountAmount?, message }
router.post('/validate', async (req, res) => {
  try {
    const body = req.body as { code?: string; subtotal?: number; isCampusOrder?: boolean; campusId?: string };
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : undefined;
    const subtotal = typeof body.subtotal === 'number' ? Math.max(0, Math.floor(body.subtotal)) : undefined;
    const isCampusOrder = body.isCampusOrder === true;
    const campusId = typeof body.campusId === 'string' ? body.campusId.trim() || undefined : undefined;

    if (!code) {
      res.status(400).json({ valid: false, message: 'Coupon code is required.' });
      return;
    }
    if (subtotal === undefined || subtotal < 0) {
      res.status(400).json({ valid: false, message: 'Valid subtotal (paise) is required.' });
      return;
    }

    const coupon = await prisma.coupon.findUnique({
      where: { code },
    });

    if (!coupon) {
      res.json({ valid: false, message: 'Invalid coupon code.' });
      return;
    }
    if (!coupon.isActive) {
      res.json({ valid: false, message: 'This coupon is no longer active.' });
      return;
    }

    const now = new Date();
    if (now < coupon.validFrom) {
      res.json({
        valid: false,
        message: `This coupon is not yet valid. Valid from ${formatDateTimeIST(coupon.validFrom)}.`,
      });
      return;
    }
    if (now > coupon.validTo) {
      res.json({
        valid: false,
        message: `This coupon has expired. It was valid until ${formatDateTimeIST(coupon.validTo)}.`,
      });
      return;
    }
    if (coupon.minOrderAmount !== null && coupon.minOrderAmount !== undefined && subtotal < coupon.minOrderAmount) {
      const minRupees = (coupon.minOrderAmount / 100).toFixed(0);
      res.json({ valid: false, message: `Minimum order amount is ₹${minRupees} to use this coupon.` });
      return;
    }
    if (coupon.maxUses !== null && coupon.maxUses !== undefined && coupon.usedCount >= coupon.maxUses) {
      res.json({ valid: false, message: 'This coupon has reached its usage limit.' });
      return;
    }
    if (coupon.campusOnly) {
      if (!isCampusOrder) {
        res.json({ valid: false, message: 'This coupon is only valid for campus delivery orders.' });
        return;
      }
      const allowedIds = coupon.allowedCampusIds ?? [];
      if (allowedIds.length > 0 && (!campusId || !allowedIds.includes(campusId))) {
        res.json({ valid: false, message: 'This coupon is not valid for the selected campus.' });
        return;
      }
    }

    const freeShipping = coupon.type === 'FREE_SHIPPING';
    let discountAmount: number;
    let message: string;
    if (freeShipping) {
      discountAmount = 0;
      message = 'Free shipping applied.';
    } else if (coupon.type === 'PERCENT') {
      discountAmount = Math.floor((subtotal * coupon.value) / 100);
      message = `You save ₹${(discountAmount / 100).toFixed(2)}.`;
    } else {
      discountAmount = Math.min(coupon.value, subtotal);
      message = `You save ₹${(discountAmount / 100).toFixed(2)}.`;
    }

    res.json({
      valid: true,
      discountAmount,
      freeShipping,
      message,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
