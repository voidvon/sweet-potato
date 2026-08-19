import { imageGenerationChatCapabilityHandler } from './capabilities/chat-capability-image.provider.js';
import type { ChatCapabilityHandler, ChatCapabilityName } from './chat-capability.types.js';

const handlers: ChatCapabilityHandler[] = [imageGenerationChatCapabilityHandler];

export function listChatCapabilityHandlers() {
  return handlers;
}

export function findChatCapabilityHandler(capability: ChatCapabilityName) {
  return handlers.find((item) => item.capability === capability);
}
