import type {
  ChatConversation,
  ChatConversationDetail,
  ChatMessage,
  ChatStreamEvent,
  SendChatPayload,
} from '../../types';
import { API_BASE_URL, request } from '../request';
import { withAuthToken } from '../../utils/session';

enum Api {
  conversations = '/api/chat/conversations',
  conversationDetail = '/api/chat/conversations/:conversationId',
  conversationMessages = '/api/chat/conversations/:conversationId/messages',
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

export async function streamChatMessage(
  payload: SendChatPayload,
  onEvent: (event: ChatStreamEvent) => void,
) {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(resolveWebSocketUrl(Api.streamMessageWs));
    let settled = false;

    function settle(callback: () => void) {
      if (settled) {
        return;
      }
      settled = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      callback();
    }

    socket.onopen = () => {
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
      settle(() => reject(new Error('聊天 WebSocket 连接失败')));
    };

    socket.onclose = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error('聊天 WebSocket 连接已断开'));
    };
  });
}
