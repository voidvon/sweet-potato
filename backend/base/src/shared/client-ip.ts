import type { Request } from 'express';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

export function normalizeClientIp(value: string | undefined | null) {
  const ip = String(value || 'unknown').trim();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function resolveClientIp(req: Request) {
  return normalizeClientIp(req.ip || req.socket.remoteAddress);
}

function isTrustedProxyIp(value: string) {
  const ip = normalizeClientIp(value);
  if (ip === '::1') return true;
  if (isIP(ip) === 4) {
    const [first, second] = ip.split('.').map(Number);
    return first === 10
      || first === 127
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
  }
  return isIP(ip) === 6 && (/^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip));
}

export function resolveIncomingClientIp(request: IncomingMessage) {
  const forwarded = request.headers['x-forwarded-for'];
  const remoteIp = normalizeClientIp(request.socket.remoteAddress);
  if (!isTrustedProxyIp(remoteIp)) return remoteIp;

  const forwardedValue = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  const forwardedIps = String(forwardedValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (let index = forwardedIps.length - 1; index >= 0; index -= 1) {
    const ip = normalizeClientIp(forwardedIps[index]);
    if (!isTrustedProxyIp(ip)) return ip;
  }
  return normalizeClientIp(forwardedIps[0] || remoteIp);
}
