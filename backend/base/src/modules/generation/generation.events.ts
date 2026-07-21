import type { ChatMessage } from '../chat/chat.types.js';
import type { GenerationJob, GenerationJobItem } from './generation.types.js';
import { publishAppEvent, registerAppEventClient } from '../app-events/app.events.js';

export type GenerationRealtimeEvent = {
  type: 'generation-job-updated';
  userId: string;
  job: GenerationJob;
  items?: GenerationJobItem[];
  message?: ChatMessage;
  at: string;
};

export const registerGenerationEventClient = registerAppEventClient;

export function publishGenerationEvent(event: GenerationRealtimeEvent) {
  publishAppEvent(event);
}
