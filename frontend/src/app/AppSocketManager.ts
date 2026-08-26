import { API_BASE_URL } from '@shared/api/core/request';

type MessageHandler = (message: Record<string, unknown>) => void;

class AppSocketManager {
  private socket?: WebSocket;
  private connecting?: Promise<WebSocket>;
  private handlers = new Set<MessageHandler>();
  private reconnectTimer?: number;

  private url() {
    const base = API_BASE_URL || window.location.origin;
    const parsed = new URL(base, window.location.origin);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/api/app/ws`;
    return parsed.toString();
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return this.socket;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url());
      socket.onopen = () => {
        this.socket = socket;
        this.connecting = undefined;
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
        resolve(socket);
      };
      socket.onmessage = (event) => {
        try { const value = JSON.parse(event.data) as Record<string, unknown>; this.handlers.forEach((handler) => handler(value)); } catch { /* ignore malformed events */ }
      };
      socket.onerror = () => { this.connecting = undefined; reject(new Error('应用 WebSocket 连接失败')); };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = undefined;
        this.handlers.forEach((handler) => handler({ method: 'app/disconnected', params: {} }));
        this.scheduleReconnect();
      };
    });
    return this.connecting;
  }

  async send(value: unknown) { (await this.connect()).send(JSON.stringify(value)); }
  subscribe(handler: MessageHandler) {
    this.handlers.add(handler);
    void this.connect().catch(() => this.scheduleReconnect());
    return () => {
      this.handlers.delete(handler);
      if (!this.handlers.size) {
        if (this.reconnectTimer) {
          window.clearTimeout(this.reconnectTimer);
          this.reconnectTimer = undefined;
        }
        this.socket?.close();
        this.socket = undefined;
      }
    };
  }

  private scheduleReconnect() {
    if (!this.handlers.size || this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch(() => this.scheduleReconnect());
    }, 1500);
  }
}

export const appSocketManager = new AppSocketManager();
