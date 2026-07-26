import type { Request, Response } from 'express';
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

  const user = await registerUser(email, password, name);
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
