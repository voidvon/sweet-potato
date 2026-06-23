import type { Response } from 'express';

export function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ message });
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
