import type {
  ChatConversation,
  ChatConversationDetail,
  ChatAttachment,
  ChatMessage,
  ChatStreamEvent,
  SendChatPayload,
} from '../../types';
import { API_BASE_URL, request } from '../request';
import { t } from '@shared/i18n';

enum Api {
  attachmentUpload = '/api/chat/attachments/upload',
  attachmentDirectUploadPrepare = '/api/chat/attachments/direct-upload/prepare',
  attachmentDirectUploadComplete = '/api/chat/attachments/direct-upload/complete',
  conversations = '/api/chat/conversations',
  conversationDetail = '/api/chat/conversations/:conversationId',
  conversationMessage = '/api/chat/conversations/:conversationId/messages/:messageId',
  conversationMessages = '/api/chat/conversations/:conversationId/messages',
  messages = '/api/chat/messages',
  streamMessageWs = '/api/chat/messages/ws',
}

function resolveWebSocketUrl(path: string) {
  const baseUrl = API_BASE_URL.trim();
  if (baseUrl) {
    const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

export function listChatConversations(userId: string) {
  void userId;
  return request<ChatConversation[]>(Api.conversations);
}

export function getChatMessages(conversationId: string) {
  return request<ChatMessage[]>(Api.conversationMessages.replace(':conversationId', conversationId));
}

export function getChatConversation(conversationId: string) {
  return request<ChatConversationDetail>(Api.conversationDetail.replace(':conversationId', conversationId));
}

export function renameChatConversation(conversationId: string, title: string) {
  return request<ChatConversation>(Api.conversationDetail.replace(':conversationId', conversationId), {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

export function deleteChatConversation(conversationId: string) {
  return request<void>(Api.conversationDetail.replace(':conversationId', conversationId), {
    method: 'DELETE',
  });
}

export function clearChatConversationMessages(conversationId: string) {
  return request<{ conversation: ChatConversation; messages: ChatMessage[] }>(
    Api.conversationMessages.replace(':conversationId', conversationId),
    { method: 'DELETE' },
  );
}

export function deleteChatMessage(conversationId: string, messageId: string) {
  return request<{ conversation: ChatConversation; messages: ChatMessage[] }>(
    Api.conversationMessage
      .replace(':conversationId', conversationId)
      .replace(':messageId', messageId),
    { method: 'DELETE' },
  );
}

type PrepareDirectUploadResult = {
  directUpload: false;
} | {
  directUpload: true;
  intentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

function uploadChatAttachmentThroughServer(file: File) {
  const formData = new FormData();
  formData.set('file', file);
  return request<ChatAttachment>(Api.attachmentUpload, {
    method: 'POST',
    body: formData,
  });
}

export async function uploadChatAttachment(file: File) {
  const prepared = await request<PrepareDirectUploadResult>(Api.attachmentDirectUploadPrepare, {
    method: 'POST',
    body: JSON.stringify({
      originalFileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
    }),
  });
  if (!prepared.directUpload) {
    return uploadChatAttachmentThroughServer(file);
  }
  const uploadResponse = await fetch(prepared.uploadUrl, {
    method: 'PUT',
    headers: prepared.headers,
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(t("文件上传到对象存储失败（{{0}}）", { "0": uploadResponse.status }));
  }
  return request<ChatAttachment>(Api.attachmentDirectUploadComplete, {
    method: 'POST',
    body: JSON.stringify({ intentId: prepared.intentId }),
  });
}

export function deleteChatAttachment(assetId: string) {
  return request<{ ok: boolean; deleted: boolean }>(`/api/chat/attachments/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
  });
}

export function createChatMessage(payload: SendChatPayload, options?: { signal?: AbortSignal }) {
	return request<ChatConversationDetail>(Api.messages, {
		method: 'POST',
		body: JSON.stringify(payload),
		signal: options?.signal,
	});
}

function createAbortError() {
  const error = new Error(t("聊天请求已终止"));
  error.name = 'AbortError';
  return error;
}

export async function streamChatMessage(
  payload: SendChatPayload,
  onEvent: (event: ChatStreamEvent) => void,
  options?: {
    signal?: AbortSignal;
  },
) {
  await new Promise<void>((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const socket = new WebSocket(resolveWebSocketUrl(Api.streamMessageWs));
    const turnId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let settled = false;

    const handleAbort = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          method: 'turn/interrupt',
          id: `interrupt-${turnId}`,
          params: { turnId },
        }));
      }
      settle(() => reject(createAbortError()));
    };

    function settle(callback: () => void) {
      if (settled) {
        return;
      }
      settled = true;
      options?.signal?.removeEventListener('abort', handleAbort);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      callback();
    }

    options?.signal?.addEventListener('abort', handleAbort, { once: true });

    socket.onopen = () => {
      if (options?.signal?.aborted) {
        settle(() => reject(createAbortError()));
        return;
      }
      socket.send(JSON.stringify({ method: 'turn/start', id: turnId, params: payload }));
    };

    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as ChatStreamEvent & {
          id?: string;
          method?: string;
          params?: Record<string, unknown>;
          error?: { message?: string };
        };
        if (event.error) {
          settle(() => reject(new Error(event.error.message || t("聊天请求失败"))));
          return;
        }
        if (event.method === 'turn/started' || (event.id && !event.method)) return;
        if (event.method === 'thread/updated') {
          const conversation = event.params?.conversation as ChatConversation | undefined;
          if (conversation) onEvent({ type: 'conversation', conversation });
          return;
        }
        if (event.method === 'item/agentMessage/delta') {
          onEvent({ type: 'answer_delta', delta: String(event.params?.delta || '') });
          return;
        }
        if (event.method === 'item/reasoning/delta') {
          onEvent({ type: 'reasoning_delta', delta: String(event.params?.delta || '') });
          return;
        }
        if (event.method === 'item/completed') {
          const item = event.params || {};
          const completedMessage = item.message as ChatMessage | undefined;
          if (completedMessage && item.kind === 'user_message') onEvent({ type: 'user_message', message: completedMessage });
          if (completedMessage && item.kind === 'assistant_message') onEvent({ type: 'assistant_message', message: completedMessage });
          return;
        }
        if (event.method === 'turn/completed') {
          const params = event.params || {};
          const turn = params.turn as { status?: string; error?: string } | undefined;
          if (turn?.status === 'interrupted') {
            settle(() => reject(createAbortError()));
            return;
          }
          if (turn?.status === 'failed') {
            settle(() => reject(new Error(turn.error || t("聊天请求失败"))));
            return;
          }
          const conversation = params.conversation as ChatConversation;
          const messages = params.messages as ChatMessage[];
          onEvent({ type: 'done', conversation, messages });
          settle(resolve);
          return;
        }
        if (event.type === 'error') {
          settle(() => reject(new Error(event.message)));
          return;
        }
        onEvent(event);
        if (event.type === 'done') {
          settle(resolve);
        }
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new Error(t("解析聊天流失败"))));
      }
    };

    socket.onerror = () => {
      if (options?.signal?.aborted) {
        settle(() => reject(createAbortError()));
        return;
      }
      settle(() => reject(new Error(t("聊天 WebSocket 连接失败"))));
    };

    socket.onclose = () => {
      if (settled) {
        return;
      }
      if (options?.signal?.aborted) {
        settled = true;
        options?.signal?.removeEventListener('abort', handleAbort);
        reject(createAbortError());
        return;
      }
      settled = true;
      options?.signal?.removeEventListener('abort', handleAbort);
      reject(new Error(t("聊天 WebSocket 连接已断开")));
    };
  });
}
