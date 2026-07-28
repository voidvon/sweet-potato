import type { Response } from 'express';
import type { BatchGenerationRunDetail } from './batch-generation.types.js';

type Client = {
  userId: string;
  response: Response;
  heartbeat: NodeJS.Timeout;
};

const clients = new Set<Client>();

export function registerBatchGenerationEventClient(userId: string, response: Response) {
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

export function publishBatchGenerationRun(userId: string, run: BatchGenerationRunDetail) {
  const payload = `event: run\ndata: ${JSON.stringify(run)}\n\n`;
  clients.forEach((client) => {
    if (client.userId === userId) client.response.write(payload);
  });
}
