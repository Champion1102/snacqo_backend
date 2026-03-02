import { Router, type Response } from 'express';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { createAndSendOtp, verifyOtp } from '../services/otp.js';
import { sendOtpEmail } from '../services/email.js';
import { signToken } from '../lib/jwt.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

const isProduction = process.env.NODE_ENV === 'production';

function setTokenCookie(res: Response, token: string): void {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: config.cookieMaxAgeMs,
  });
}

function clearTokenCookie(res: Response): void {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
  });
}

function sanitizeUser(user: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
}) {
  const userName =
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    user.email.split('@')[0] ||
    'Snacker';
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    userName,
    role: user.role,
  };
}

// POST /auth/admin-login – admin only (email + password)
router.post('/admin-login', async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const normalized = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, passwordHash: true },
    });

    if (!user || user.role !== 'ADMIN' || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email.split('@')[0] || 'Admin';
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role as 'USER' | 'ADMIN',
      userName,
    });
    setTokenCookie(res, token);
    res.json({ user: sanitizeUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /auth/logout – clear HttpOnly cookie (no body required)
router.post('/logout', (_req, res) => {
  clearTokenCookie(res);
  res.json({ message: 'Logged out.' });
});

// POST /auth/send-otp  body: { email, intent?: 'login' | 'signup' }
// intent=login: send OTP only if user exists; else 400 "This email is not registered. Please sign up."
// intent=signup: send OTP only if user does NOT exist; else 400 "This email is already registered. Please log in."
router.post('/send-otp', async (req, res) => {
  try {
    const { email, intent } = req.body as { email?: string; intent?: string };
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }

    const normalized = email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true },
    });

    if (intent === 'login') {
      if (!existingUser) {
        res.status(400).json({ error: 'This email is not registered. Please sign up.' });
        return;
      }
    } else if (intent === 'signup') {
      if (existingUser) {
        res.status(400).json({ error: 'This email is already registered. Please log in.' });
        return;
      }
    }

    const result = await createAndSendOtp(email, sendOtpEmail);
    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }

    res.json({ message: 'OTP sent.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, firstName, lastName } = req.body as {
      email?: string;
      otp?: string;
      firstName?: string;
      lastName?: string;
    };

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }
    if (!otp || typeof otp !== 'string' || otp.length !== 6) {
      res.status(400).json({ error: 'Valid 6-digit OTP is required.' });
      return;
    }

    const normalized = email.trim().toLowerCase();
    const verification = await verifyOtp(normalized, otp.trim());
    if (!verification.valid) {
      res.status(400).json({ error: verification.message });
      return;
    }

    let user = await prisma.user.findUnique({ where: { email: normalized } });
    const isNewUser = !user;

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: normalized,
          emailVerified: true,
          role: 'USER',
          firstName: typeof firstName === 'string' ? firstName.trim() || null : null,
          lastName: typeof lastName === 'string' ? lastName.trim() || null : null,
        },
      });
    }

    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email.split('@')[0] || 'Snacker';
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role as 'USER' | 'ADMIN',
      userName,
    });
    setTokenCookie(res, token);
    res.json({ user: sanitizeUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const id = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    res.json({ user: sanitizeUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
