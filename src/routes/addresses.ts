import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth);

// GET /users/me/addresses
router.get('/', async (req, res) => {
  try {
    const userId = req.user!.id;
    const addresses = await prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ addresses });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /users/me/addresses
router.post('/', async (req, res) => {
  try {
    const userId = req.user!.id;
    const body = req.body as Record<string, unknown>;
    const label = typeof body.label === 'string' ? body.label.trim() : undefined;
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
    const line1 = typeof body.line1 === 'string' ? body.line1.trim() : undefined;
    const line2 = typeof body.line2 === 'string' ? body.line2.trim() : null;
    const city = typeof body.city === 'string' ? body.city.trim() : undefined;
    const state = typeof body.state === 'string' ? body.state.trim() : undefined;
    const pincode = typeof body.pincode === 'string' ? body.pincode.trim() : undefined;
    const isDefault = body.isDefault === true;

    if (!label || !name || !phone || !line1 || !city || !state || !pincode) {
      res.status(400).json({
        error: 'Missing required fields: label, name, phone, line1, city, state, pincode.',
      });
      return;
    }

    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.create({
      data: {
        userId,
        label,
        name,
        phone,
        line1,
        line2: line2 || undefined,
        city,
        state,
        pincode,
        isDefault: isDefault || false,
      },
    });
    res.status(201).json({ address });
  } catch (e: unknown) {
    const prismaError = e as { code?: string };
    if (prismaError.code === 'P2002') {
      res.status(409).json({ error: 'An address with this label already exists.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// PATCH /users/me/addresses/:id
router.patch('/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id;
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.address.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ error: 'Address not found.' });
      return;
    }

    const updates: {
      label?: string;
      name?: string;
      phone?: string;
      line1?: string;
      line2?: string | null;
      city?: string;
      state?: string;
      pincode?: string;
      isDefault?: boolean;
    } = {};

    if (typeof body.label === 'string') updates.label = body.label.trim();
    if (typeof body.name === 'string') updates.name = body.name.trim();
    if (typeof body.phone === 'string') updates.phone = body.phone.trim();
    if (typeof body.line1 === 'string') updates.line1 = body.line1.trim();
    if (body.line2 !== undefined) updates.line2 = typeof body.line2 === 'string' ? body.line2.trim() || null : null;
    if (typeof body.city === 'string') updates.city = body.city.trim();
    if (typeof body.state === 'string') updates.state = body.state.trim();
    if (typeof body.pincode === 'string') updates.pincode = body.pincode.trim();
    if (typeof body.isDefault === 'boolean') updates.isDefault = body.isDefault;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    if (updates.isDefault === true) {
      await prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.update({
      where: { id },
      data: updates,
    });
    res.json({ address });
  } catch (e: unknown) {
    const prismaError = e as { code?: string };
    if (prismaError.code === 'P2002') {
      res.status(409).json({ error: 'An address with this label already exists.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DELETE /users/me/addresses/:id
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id;

    const existing = await prisma.address.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ error: 'Address not found.' });
      return;
    }

    await prisma.address.delete({ where: { id } });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
