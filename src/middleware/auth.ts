import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import User from '../models/User';

export interface AuthedRequest extends Request {
  userId?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    res.status(401).json({ message: 'Missing token' });
    return;
  }

  let userId: string;
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: string };
    userId = payload.sub;
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
    return;
  }

  // The JWT's signature alone can't know the account was deleted after it
  // was issued — confirm the user still exists so a deleted account's token
  // stops working immediately instead of staying valid until it expires.
  const exists = await User.exists({ _id: userId });
  if (!exists) {
    res.status(401).json({ message: 'Account no longer exists' });
    return;
  }

  req.userId = userId;
  next();
}
