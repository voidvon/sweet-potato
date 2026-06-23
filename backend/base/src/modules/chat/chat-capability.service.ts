import { findChatCapabilityHandler, listChatCapabilityHandlers } from './chat-capability.registry.js';
import type { ChatCapabilityExecutionInput, ChatCapabilityInvocation, ChatRequestedCapability } from './chat-capability.types.js';

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function stripMentionTokens(content: string, tokens: string[]) {
  let nextContent = String(content || '');
  tokens.forEach((token) => {
    nextContent = nextContent.replaceAll(token, ' ');
  });
  return cleanText(nextContent);
}

export function parseChatCapabilityInvocation(content: string): ChatCapabilityInvocation | null {
  const normalized = String(content || '');
  for (const handler of listChatCapabilityHandlers()) {
    const mentionToken = handler.mentionTokens.find((token) => normalized.includes(token));
    if (!mentionToken) {
      continue;
    }
    return {
      capability: handler.capability,
      mentionToken,
      cleanedContent: cleanText(normalized.replaceAll(mentionToken, ' ')),
    };
  }
  return null;
}

export function resolveChatCapabilityInvocation(content: string, requestedCapabilities?: ChatRequestedCapability[]): ChatCapabilityInvocation | null {
  const explicitCapability = requestedCapabilities?.[0];
  if (explicitCapability) {
    const handler = findChatCapabilityHandler(explicitCapability);
    if (handler) {
      const sourceText = String(content || '');
      const mentionToken = handler.mentionTokens.find((token) => sourceText.includes(token)) || `@${explicitCapability}`;
      return {
        capability: handler.capability,
        mentionToken,
        cleanedContent: stripMentionTokens(sourceText, handler.mentionTokens),
      };
    }
  }
  return parseChatCapabilityInvocation(content);
}

export async function dispatchChatCapability(input: ChatCapabilityExecutionInput & { invocation: ChatCapabilityInvocation }) {
  const handler = findChatCapabilityHandler(input.invocation.capability);
  if (!handler) {
    throw new Error(`未找到能力处理器：${input.invocation.capability}`);
  }

  return handler.execute({
    userId: input.userId,
    content: input.invocation.cleanedContent,
    agent: input.agent,
    modelConfig: input.modelConfig,
    history: input.history,
    capabilityContext: input.capabilityContext,
    conversation: input.conversation,
  });
}
