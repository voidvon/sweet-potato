import type { Response } from 'express';
import type { ContentAsset } from './content.types.js';

export type ContentRealtimeEvent = {
  type: 'digital-human-three-view-status' | 'viral-video-analysis-status' | 'viral-video-analysis-delta' | 'viral-video-analysis-complete';
  userId: string;
  groupId?: string;
  taskId?: string;
  status?: 'running' | 'success' | 'failed';
  phase?: 'uploading' | 'vod-uploading' | 'vod-uploaded' | 'submitted' | 'polling' | 'message-start' | 'message-complete' | 'completed' | 'failed' | 'storyboard-ready' | 'storyboard-failed' | 'director-generating' | 'director-completed' | 'director-failed';
  progress?: number;
  messageId?: string;
  roleName?: string;
  message?: string;
  delta?: string;
  task?: unknown;
  asset?: ContentAsset;
  failureReason?: string;
  at: string;
};

const clientsByUserId = new Map<string, Set<Response>>();

function writeEvent(client: Response, event: ContentRealtimeEvent) {
  client.write(`event: ${event.type}\n`);
  client.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function registerContentEventClient(userId: string, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(': connected\n\n');
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25_000);

  const clients = clientsByUserId.get(userId) || new Set<Response>();
  clients.add(res);
  clientsByUserId.set(userId, clients);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (!clients.size) {
      clientsByUserId.delete(userId);
    }
  });
}

export function publishContentEvent(event: ContentRealtimeEvent) {
  const clients = clientsByUserId.get(event.userId);
  if (!clients?.size) {
    return;
  }
  clients.forEach((client) => writeEvent(client, event));
}
