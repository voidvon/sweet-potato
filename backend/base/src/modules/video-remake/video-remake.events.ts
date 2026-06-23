import type { Response } from 'express';
import type { VideoRemakeWorkflowEvent } from './video-remake.types.js';

type Client = {
  userId: string;
  response: Response;
  heartbeat: NodeJS.Timeout;
};

const clients = new Set<Client>();

export function registerVideoRemakeEventClient(userId: string, response: Response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
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

export function publishVideoRemakeEvent(userId: string, event: VideoRemakeWorkflowEvent & { sessionId?: string; taskId?: string }) {
  const payload = `event: workflow\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    if (client.userId === userId) {
      client.response.write(payload);
    }
  }
}
