import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /campuses – list active campuses (public, for checkout dropdown)
router.get('/', async (_req, res) => {
  try {
    const campuses = await prisma.campus.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        line1: true,
        line2: true,
        city: true,
        state: true,
        pincode: true,
      },
    });
    res.json({ campuses });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
