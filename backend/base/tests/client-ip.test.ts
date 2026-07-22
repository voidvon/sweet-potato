import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from 'node:http';
import { resolveIncomingClientIp } from '../src/shared/client-ip.js';

function createRequest(remoteAddress: string, forwardedFor?: string) {
  return {
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    socket: { remoteAddress },
  } as IncomingMessage;
}

test('resolves the client address through multiple trusted proxies', () => {
  const request = createRequest('172.20.0.3', '203.0.113.9, 172.20.0.1');
  assert.equal(resolveIncomingClientIp(request), '203.0.113.9');
});

test('does not trust forwarded addresses sent directly by an external client', () => {
  const request = createRequest('198.51.100.8', '203.0.113.9');
  assert.equal(resolveIncomingClientIp(request), '198.51.100.8');
});

test('normalizes IPv4-mapped addresses', () => {
  const request = createRequest('::ffff:172.20.0.3', '::ffff:203.0.113.9');
  assert.equal(resolveIncomingClientIp(request), '203.0.113.9');
});
