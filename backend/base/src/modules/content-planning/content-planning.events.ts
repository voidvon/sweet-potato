import type { Response } from 'express';
import type {
  ContentPlanningReasoningLog,
  ContentPlanningReasoningStream,
} from './content-planning.types.js';

export type ContentPlanningRealtimeEvent = {
  type: 'reasoning_stream' | 'stage_completed' | 'generation_failed';
  sessionId: string;
  reasoningStream: ContentPlanningReasoningStream | null;
  reasoningLog?: ContentPlanningReasoningLog;
};

type Client = {
  userId: string;
  response: Response;
  heartbeat: NodeJS.Timeout;
};

const clients = new Set<Client>();

export function registerContentPlanningEventClient(userId: string, response: Response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders?.();
  response.socket?.setNoDelay(true);
  response.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  const heartbeat = setInterval(() => {
    response.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, 25_000);
  const client = { userId, response, heartbeat };
  clients.add(client);
  response.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

export function publishContentPlanningEvent(userId: string, event: ContentPlanningRealtimeEvent) {
  const payload = `event: planning\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    if (client.userId === userId) {
      client.response.write(payload);
    }
  }
}
