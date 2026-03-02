import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

const KEY_ALLOW_MULTIPLE_COUPONS = 'allow_multiple_coupons';

// GET /admin/settings – get settings used by admin (e.g. coupon page)
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: KEY_ALLOW_MULTIPLE_COUPONS },
    });
    const allowMultipleCoupons = row?.value === 'true';
    res.json({ allowMultipleCoupons });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// PATCH /admin/settings – update settings (body: { allowMultipleCoupons?: boolean })
router.patch('/', requireAdmin, async (req, res) => {
  try {
    const body = req.body as { allowMultipleCoupons?: boolean };
    if (typeof body.allowMultipleCoupons !== 'boolean') {
      res.status(400).json({ error: 'allowMultipleCoupons (boolean) is required.' });
      return;
    }
    await prisma.setting.upsert({
      where: { key: KEY_ALLOW_MULTIPLE_COUPONS },
      create: { key: KEY_ALLOW_MULTIPLE_COUPONS, value: body.allowMultipleCoupons ? 'true' : 'false' },
      update: { value: body.allowMultipleCoupons ? 'true' : 'false' },
    });
    res.json({ allowMultipleCoupons: body.allowMultipleCoupons });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
