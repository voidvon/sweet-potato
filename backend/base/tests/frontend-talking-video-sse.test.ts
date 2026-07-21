import assert from 'node:assert/strict';
import test from 'node:test';
import talkingVideoSseModule from '../../../frontend/web/src/api/talkingVideoSse.js';

const { createUtf8SseEventParser } = talkingVideoSseModule;

test('talking video SSE parser preserves split multibyte UTF-8 data across chunks', () => {
  const source = 'event: reasoning_delta\ndata: {"type":"reasoning_delta","delta":"装修细节：插座预留"}\n\n';
  const prefix = 'event: reasoning_delta\ndata: {"type":"reasoning_delta","delta":"装修细节：';
  const firstChunkLength = new TextEncoder().encode(prefix).length + 1;
  const bytes = new TextEncoder().encode(source);
  const parser = createUtf8SseEventParser<{ type: string; delta: string }>((data) => JSON.parse(data));

  const firstEvents = parser.push(bytes.slice(0, firstChunkLength));
  const secondEvents = parser.push(bytes.slice(firstChunkLength));

  assert.deepEqual(firstEvents, []);
  assert.equal(secondEvents.length, 1);
  assert.equal(secondEvents[0]?.delta, '装修细节：插座预留');
});

test('talking video SSE parser flushes a terminal event without a trailing blank line exactly once', () => {
  const parser = createUtf8SseEventParser<{ type: string; prompt: string }>((data) => JSON.parse(data));
  const events = parser.push(new TextEncoder().encode('event: result\ndata: {"type":"result","prompt":"最终提示词"}'));
  const tail = parser.finish();

  assert.deepEqual(events, []);
  assert.equal(tail.length, 1);
  assert.equal(tail[0]?.prompt, '最终提示词');
  assert.deepEqual(parser.finish(), []);
});
