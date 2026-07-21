import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Response } from 'express';
import { registerAppEventClient } from '../src/modules/app-events/app.events.js';
import { publishCreditBalanceUpdated } from '../src/modules/billing/billing.events.js';

class TestResponse extends EventEmitter {
  chunks: string[] = [];

  setHeader() {
    return this;
  }

  flushHeaders() {}

  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
}

test('credit balance events are delivered only to the matching user', () => {
  const matchingResponse = new TestResponse();
  const otherResponse = new TestResponse();
  registerAppEventClient('user-1', matchingResponse as unknown as Response);
  registerAppEventClient('user-2', otherResponse as unknown as Response);

  publishCreditBalanceUpdated({
    userId: 'user-1',
    creditBalance: 98.5,
    creditDelta: -1.5,
  });

  const matchingOutput = matchingResponse.chunks.join('');
  assert.match(matchingOutput, /event: credit-balance-updated/u);
  assert.match(matchingOutput, /"creditBalance":98\.5/u);
  assert.doesNotMatch(otherResponse.chunks.join(''), /credit-balance-updated/u);

  matchingResponse.emit('close');
  otherResponse.emit('close');
});
