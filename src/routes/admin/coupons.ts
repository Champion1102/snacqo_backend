import { Router } from 'express';
import { PrismaClient, type CouponType } from '@prisma/client';
import { requireAdmin } from '../../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// GET /admin/coupons – list all
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ coupons });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /admin/coupons  { code, type, value, minOrderAmount?, maxUses?, validFrom, validTo, campusOnly?, allowedCampusIds? }
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      code?: string;
      type?: string;
      value?: number;
      minOrderAmount?: number | null;
      maxUses?: number | null;
      validFrom?: string;
      validTo?: string;
      campusOnly?: boolean;
      allowedCampusIds?: string[];
    };
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : undefined;
    const typeRaw = body.type?.toString().toUpperCase();
    const isFreeShipping = typeRaw === 'FREE_SHIPPING';
    const type = (typeRaw === 'FIXED' ? 'FIXED' : isFreeShipping ? 'FREE_SHIPPING' : 'PERCENT') as CouponType;
    const valueInput = typeof body.value === 'number' ? Math.max(0, Math.floor(body.value)) : undefined;
    const value = isFreeShipping ? 0 : valueInput;
    const minOrderAmount = body.minOrderAmount != null ? Math.max(0, Math.floor(Number(body.minOrderAmount))) : null;
    const maxUses = body.maxUses != null ? Math.max(0, Math.floor(Number(body.maxUses))) : null;
    const validFrom = body.validFrom ? new Date(body.validFrom) : undefined;
    const validTo = body.validTo ? new Date(body.validTo) : undefined;
    const campusOnly = body.campusOnly === true;
    const allowedCampusIds = Array.isArray(body.allowedCampusIds)
      ? body.allowedCampusIds.filter((id): id is string => typeof id === 'string').filter(Boolean)
      : [];

    if (!code) {
      res.status(400).json({ error: 'code is required.' });
      return;
    }
    if (!isFreeShipping && valueInput === undefined) {
      res.status(400).json({ error: 'value is required for Percent and Fixed coupons.' });
      return;
    }
    if (!validFrom || !validTo || isNaN(validFrom.getTime()) || isNaN(validTo.getTime())) {
      res.status(400).json({ error: 'validFrom and validTo are required (ISO date strings).' });
      return;
    }
    if (type === 'PERCENT' && (valueInput === undefined || valueInput > 100)) {
      res.status(400).json({ error: 'Percent value must be between 0 and 100.' });
      return;
    }

    const coupon = await prisma.coupon.create({
      data: { code, type, value: value ?? 0, minOrderAmount, maxUses, validFrom, validTo, campusOnly, allowedCampusIds },
    });
    res.status(201).json({ coupon });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      res.status(409).json({ error: 'A coupon with this code already exists.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// PATCH /admin/coupons/:id  partial
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body as {
      code?: string;
      type?: string;
      value?: number;
      minOrderAmount?: number | null;
      maxUses?: number | null;
      validFrom?: string;
      validTo?: string;
      isActive?: boolean;
      campusOnly?: boolean;
      allowedCampusIds?: string[];
    };
    const data: Record<string, unknown> = {};
    if (typeof body.code === 'string') data.code = body.code.trim().toUpperCase();
    if (body.type === 'PERCENT' || body.type === 'FIXED' || body.type === 'FREE_SHIPPING') data.type = body.type;
    if (body.type === 'FREE_SHIPPING') data.value = 0;
    else if (typeof body.value === 'number') data.value = Math.max(0, Math.floor(body.value));
    if (body.minOrderAmount !== undefined) data.minOrderAmount = body.minOrderAmount == null ? null : Math.max(0, Math.floor(Number(body.minOrderAmount)));
    if (body.maxUses !== undefined) data.maxUses = body.maxUses == null ? null : Math.max(0, Math.floor(Number(body.maxUses)));
    if (typeof body.validFrom === 'string') data.validFrom = new Date(body.validFrom);
    if (typeof body.validTo === 'string') data.validTo = new Date(body.validTo);
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (typeof body.campusOnly === 'boolean') data.campusOnly = body.campusOnly;
    if (Array.isArray(body.allowedCampusIds)) data.allowedCampusIds = body.allowedCampusIds.filter((id): id is string => typeof id === 'string').filter(Boolean);

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const coupon = await prisma.coupon.update({
      where: { id },
      data,
    });
    res.json({ coupon });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code: string }).code;
      if (code === 'P2025') {
        res.status(404).json({ error: 'Coupon not found.' });
        return;
      }
      if (code === 'P2002') res.status(409).json({ error: 'Coupon code already exists.' });
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DELETE /admin/coupons/:id – deactivate (set isActive false); optionally hard-delete
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const hard = req.query.delete === 'true';

    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      res.status(404).json({ error: 'Coupon not found.' });
      return;
    }

    if (hard) {
      await prisma.coupon.delete({ where: { id } });
      res.status(204).send();
      return;
    }

    await prisma.coupon.update({
      where: { id },
      data: { isActive: false },
    });
    res.status(204).send();
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2025') {
      res.status(404).json({ error: 'Coupon not found.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
