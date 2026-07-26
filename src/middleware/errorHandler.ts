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
  // Full error (message + stack, Mongo error codes, etc.) is for server logs
  // only — echoing it back to the client leaks internals (schema field
  // names, query shape, dependency versions embedded in error strings).
  console.error('Unhandled request error', err);
  res.status(500).json({ message: 'Internal server error' });
}
