import type { Response } from 'express';

type AppRealtimeEvent = {
  type: string;
  userId: string;
};

const clientsByUserId = new Map<string, Set<Response>>();

function writeEvent<Event extends AppRealtimeEvent>(client: Response, event: Event) {
  client.write(`event: ${event.type}\n`);
  client.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function registerAppEventClient(userId: string, response: Response) {
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

export function publishAppEvent<Event extends AppRealtimeEvent>(event: Event) {
  const clients = clientsByUserId.get(event.userId);
  if (!clients?.size) {
    return;
  }
  clients.forEach((client) => writeEvent(client, event));
}
