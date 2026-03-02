import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const KEY_ALLOW_MULTIPLE_COUPONS = 'allow_multiple_coupons';

// GET /settings – public, for checkout to know if multiple coupons allowed
router.get('/', async (_req, res) => {
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

export default router;
