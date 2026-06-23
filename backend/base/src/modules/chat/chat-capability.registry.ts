import { xingtuChatCapabilityHandler } from './capabilities/chat-capability-xingtu.provider.js';
import type { ChatCapabilityHandler, ChatCapabilityName } from './chat-capability.types.js';

const handlers: ChatCapabilityHandler[] = [xingtuChatCapabilityHandler];

export function listChatCapabilityHandlers() {
  return handlers;
}

export function findChatCapabilityHandler(capability: ChatCapabilityName) {
  return handlers.find((item) => item.capability === capability);
}
