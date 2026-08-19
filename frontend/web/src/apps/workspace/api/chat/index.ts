import type {
  ChatConversation,
  ChatConversationDetail,
  ChatAttachment,
  ChatMessage,
  ChatStreamEvent,
  SendChatPayload,
} from '../../types';
import { API_BASE_URL, request } from '../request';
import { withAuthToken } from '../../utils/session';

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
    return withAuthToken(url.toString());
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return withAuthToken(`${protocol}//${window.location.host}${path}`);
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
    throw new Error(`文件上传到对象存储失败（${uploadResponse.status}）`);
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

export function createChatMessage(payload: SendChatPayload) {
  return request<ChatConversationDetail>(Api.messages, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function createAbortError() {
  const error = new Error('聊天请求已终止');
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
    let settled = false;

    const handleAbort = () => {
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
      socket.send(JSON.stringify(payload));
    };

    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as ChatStreamEvent;
        if (event.type === 'error') {
          settle(() => reject(new Error(event.message)));
          return;
        }
        onEvent(event);
        if (event.type === 'done') {
          settle(resolve);
        }
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new Error('解析聊天流失败')));
      }
    };

    socket.onerror = () => {
      if (options?.signal?.aborted) {
        settle(() => reject(createAbortError()));
        return;
      }
      settle(() => reject(new Error('聊天 WebSocket 连接失败')));
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
      reject(new Error('聊天 WebSocket 连接已断开'));
    };
  });
}
