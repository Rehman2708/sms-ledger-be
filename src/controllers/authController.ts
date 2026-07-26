import type { Request, Response } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import AccountNickname from '../models/AccountNickname';
import RawSms from '../models/RawSms';
import Transaction from '../models/Transaction';
import User from '../models/User';
import { registerUser, signToken, validateCredentials } from '../services/authService';
import { isValidEmail, passwordStrengthError } from '../utils/validation';

export async function register(req: Request, res: Response): Promise<void> {
  const { email, password, name } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ message: 'email and password are required' });
    return;
  }
  if (typeof email !== 'string' || !isValidEmail(email)) {
    res.status(400).json({ message: 'Enter a valid email address' });
    return;
  }
  if (typeof password !== 'string') {
    res.status(400).json({ message: 'password must be a string' });
    return;
  }
  const passwordError = passwordStrengthError(password);
  if (passwordError) {
    res.status(400).json({ message: passwordError });
    return;
  }

  const existing = await User.findOne({ email });
  if (existing) {
    res.status(409).json({ message: 'User already exists' });
    return;
  }

  // The findOne check above isn't atomic with the create below — two
  // concurrent registrations for the same email can both pass it. The
  // unique index on User.email is the real guard; catch its duplicate-key
  // error here so the loser gets a clean 409 instead of falling through to
  // the generic error handler as a 500.
  let user;
  try {
    user = await registerUser(email, password, name);
  } catch (err) {
    if (err instanceof Error && (err as { code?: number }).code === 11000) {
      res.status(409).json({ message: 'User already exists' });
      return;
    }
    throw err;
  }
  const token = signToken(user.id);
  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ message: 'email and password are required' });
    return;
  }
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ message: 'email and password must be strings' });
    return;
  }

  const user = await validateCredentials(email, password);
  if (!user) {
    res.status(401).json({ message: 'Invalid email or password' });
    return;
  }

  const token = signToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
}

// Permanently wipes this user and every collection keyed to them — there's
// no soft-delete/undo here, matching what "delete account" promises the user.
export async function deleteAccount(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.userId;

  await Promise.all([
    Transaction.deleteMany({ user: userId }),
    RawSms.deleteMany({ user: userId }),
    AccountNickname.deleteMany({ user: userId }),
  ]);
  await User.findByIdAndDelete(userId);

  res.status(204).send();
}
