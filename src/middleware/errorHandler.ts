import type { NextFunction, Request, Response } from 'express';

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ message });
}
