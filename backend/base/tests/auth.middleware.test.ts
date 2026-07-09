import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { requirePermission, requireResource } from '../src/shared/auth.middleware.js';

function createMockResponse() {
  const state = {
    statusCode: 200,
    payload: null as unknown,
  };

  const response = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.payload = payload;
      return this;
    },
  } as unknown as Response;

  return { response, state };
}

function createMockRequest(systemRole: 'admin' | 'user') {
  return {
    auth: {
      systemRole,
      hasPermission: () => false,
      hasResource: () => false,
    },
  } as Request;
}

test('requirePermission lets admin bypass missing route-resource config', () => {
  const guard = requirePermission('web.module.content.future_feature');
  const req = createMockRequest('admin');
  const { response, state } = createMockResponse();
  let nextCalled = false;

  guard(req, response, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, true);
  assert.equal(state.statusCode, 200);
  assert.equal(state.payload, null);
});

test('requireResource lets admin bypass missing route-resource config', () => {
  const guard = requireResource('web.module.content.future_feature');
  const req = createMockRequest('admin');
  const { response, state } = createMockResponse();
  let nextCalled = false;

  guard(req, response, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, true);
  assert.equal(state.statusCode, 200);
  assert.equal(state.payload, null);
});

test('missing route-resource config still blocks non-admin users', () => {
  const guards = [
    requirePermission('web.module.content.future_feature'),
    requireResource('web.module.content.future_feature'),
  ];

  for (const guard of guards) {
    const req = createMockRequest('user');
    const { response, state } = createMockResponse();
    let nextCalled = false;

    guard(req, response, (() => {
      nextCalled = true;
    }) as NextFunction);

    assert.equal(nextCalled, false);
    assert.equal(state.statusCode, 403);
    assert.deepEqual(state.payload, { message: '当前账号无权访问该功能' });
  }
});
