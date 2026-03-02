import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth);

// GET /users/me – current user profile (firstName, lastName, phone, birthday, newsletter)
router.get('/', async (req, res) => {
  try {
    const id = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        birthday: true,
        newsletter: true,
      },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    res.json({
      user: {
        ...user,
        birthday: user.birthday ? user.birthday.toISOString().slice(0, 10) : null,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// PATCH /users/me – update profile (firstName, lastName, phone, birthday, newsletter)
router.patch('/', async (req, res) => {
  try {
    const id = req.user!.id;
    const body = req.body as Record<string, unknown>;

    const updates: {
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
      birthday?: Date | null;
      newsletter?: boolean;
    } = {};

    if (typeof body.firstName === 'string') updates.firstName = body.firstName.trim() || null;
    if (typeof body.lastName === 'string') updates.lastName = body.lastName.trim() || null;
    if (typeof body.phone === 'string') updates.phone = body.phone.trim() || null;
    if (typeof body.newsletter === 'boolean') updates.newsletter = body.newsletter;
    if (body.birthday !== undefined && body.birthday !== null) {
      if (typeof body.birthday === 'string') {
        const d = new Date(body.birthday);
        if (!isNaN(d.getTime())) updates.birthday = d;
      }
    } else if (body.birthday === null) {
      updates.birthday = null;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        birthday: true,
        newsletter: true,
      },
    });
    res.json({
      user: {
        ...user,
        birthday: user.birthday ? user.birthday.toISOString().slice(0, 10) : null,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
