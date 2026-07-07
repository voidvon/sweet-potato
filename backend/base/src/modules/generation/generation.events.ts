import type { Response } from 'express';
import type { ChatMessage } from '../chat/chat.types.js';
import type { GenerationJob, GenerationJobItem } from './generation.types.js';

export type GenerationRealtimeEvent = {
  type: 'generation-job-updated';
  userId: string;
  job: GenerationJob;
  items?: GenerationJobItem[];
  message?: ChatMessage;
  at: string;
};

const clientsByUserId = new Map<string, Set<Response>>();

function writeEvent(client: Response, event: GenerationRealtimeEvent) {
  client.write(`event: ${event.type}\n`);
  client.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function registerGenerationEventClient(userId: string, response: Response) {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders?.();
  response.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    response.write(': heartbeat\n\n');
  }, 25_000);

  const clients = clientsByUserId.get(userId) || new Set<Response>();
  clients.add(response);
  clientsByUserId.set(userId, clients);

  response.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(response);
    if (!clients.size) {
      clientsByUserId.delete(userId);
    }
  });
}

export function publishGenerationEvent(event: GenerationRealtimeEvent) {
  const clients = clientsByUserId.get(event.userId);
  if (!clients?.size) {
    return;
  }
  clients.forEach((client) => writeEvent(client, event));
}
