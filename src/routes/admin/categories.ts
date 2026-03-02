import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// GET /admin/categories – list all (admin view)
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
      },
    });
    res.json({ categories });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /admin/categories  { name, slug, sortOrder? }
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = req.body as { name?: string; slug?: string; sortOrder?: number };
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase().replace(/\s+/g, '-') : undefined;
    const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;

    if (!name || !slug) {
      res.status(400).json({ error: 'name and slug are required.' });
      return;
    }

    const category = await prisma.category.create({
      data: { name, slug, sortOrder },
    });
    res.status(201).json({ category });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
      res.status(409).json({ error: 'A category with this slug already exists.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// PATCH /admin/categories/:id  partial { name?, slug?, sortOrder? }
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body as { name?: string; slug?: string; sortOrder?: number };
    const data: { name?: string; slug?: string; sortOrder?: number } = {};
    if (typeof body.name === 'string') data.name = body.name.trim();
    if (typeof body.slug === 'string') data.slug = body.slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const category = await prisma.category.update({
      where: { id },
      data,
    });
    res.json({ category });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e) {
      if (e.code === 'P2025') {
        res.status(404).json({ error: 'Category not found.' });
        return;
      }
      if (e.code === 'P2002') {
        res.status(409).json({ error: 'A category with this slug already exists.' });
        return;
      }
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DELETE /admin/categories/:id – only if no products
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!category) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }
    if (category._count.products > 0) {
      res.status(400).json({ error: 'Cannot delete category that has products. Remove or reassign products first.' });
      return;
    }
    await prisma.category.delete({ where: { id } });
    res.status(204).send();
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2025') {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
