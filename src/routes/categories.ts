import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// GET /categories – public, for nav/filters
router.get('/', async (_req, res) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, slug: true, sortOrder: true },
    });
    res.json({ categories });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
