import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { verifyToken } from '../lib/jwt.js';

function getToken(req: Request): string | null {
  const cookie = req.cookies?.[config.cookieName];
  if (cookie && typeof cookie === 'string') return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getToken(req);

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    userName: payload.userName,
  };
  next();
}

/** Sets req.user if valid token present; does not fail if missing or invalid. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = getToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        userName: payload.userName,
      };
    }
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'ADMIN') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  });
}
