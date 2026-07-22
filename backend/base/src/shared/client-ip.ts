import type { Request } from 'express';
import type { IncomingMessage } from 'node:http';

export function normalizeClientIp(value: string | undefined | null) {
  const ip = String(value || 'unknown').trim();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function resolveClientIp(req: Request) {
  return normalizeClientIp(req.ip || req.socket.remoteAddress);
}

export function resolveIncomingClientIp(request: IncomingMessage) {
  const forwarded = request.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded.at(-1) : forwarded;
  const forwardedIp = String(forwardedValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  return normalizeClientIp(forwardedIp || request.socket.remoteAddress);
}
