import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// GET /admin/campuses – list all
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const campuses = await prisma.campus.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ campuses });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /admin/campuses
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      name?: string;
      line1?: string;
      line2?: string | null;
      city?: string;
      state?: string;
      pincode?: string;
      sortOrder?: number;
    };
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const line1 = typeof body.line1 === 'string' ? body.line1.trim() : undefined;
    const line2 = body.line2 != null ? (typeof body.line2 === 'string' ? body.line2.trim() : null) : null;
    const city = typeof body.city === 'string' ? body.city.trim() : undefined;
    const state = typeof body.state === 'string' ? body.state.trim() : undefined;
    const pincode = typeof body.pincode === 'string' ? body.pincode.trim() : undefined;
    const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;

    if (!name || !line1 || !city || !state || !pincode) {
      res.status(400).json({ error: 'name, line1, city, state, and pincode are required.' });
      return;
    }

    const campus = await prisma.campus.create({
      data: { name, line1, line2, city, state, pincode, sortOrder },
    });
    res.status(201).json({ campus });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// PATCH /admin/campuses/:id
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body as {
      name?: string;
      line1?: string;
      line2?: string | null;
      city?: string;
      state?: string;
      pincode?: string;
      isActive?: boolean;
      sortOrder?: number;
    };
    const data: Record<string, unknown> = {};
    if (typeof body.name === 'string') data.name = body.name.trim();
    if (typeof body.line1 === 'string') data.line1 = body.line1.trim();
    if (body.line2 !== undefined) data.line2 = body.line2 == null ? null : String(body.line2).trim();
    if (typeof body.city === 'string') data.city = body.city.trim();
    if (typeof body.state === 'string') data.state = body.state.trim();
    if (typeof body.pincode === 'string') data.pincode = body.pincode.trim();
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const campus = await prisma.campus.update({
      where: { id },
      data,
    });
    res.json({ campus });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2025') {
      res.status(404).json({ error: 'Campus not found.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DELETE /admin/campuses/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    await prisma.campus.delete({ where: { id } });
    res.status(204).send();
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2025') {
      res.status(404).json({ error: 'Campus not found.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
