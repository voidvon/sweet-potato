import { imageGenerationChatCapabilityHandler } from './capabilities/chat-capability-image.provider.js';
import { xingtuChatCapabilityHandler } from './capabilities/chat-capability-xingtu.provider.js';
import type { ChatCapabilityHandler, ChatCapabilityName } from './chat-capability.types.js';

const handlers: ChatCapabilityHandler[] = [xingtuChatCapabilityHandler, imageGenerationChatCapabilityHandler];

export function listChatCapabilityHandlers() {
  return handlers;
}

export function findChatCapabilityHandler(capability: ChatCapabilityName) {
  return handlers.find((item) => item.capability === capability);
}
