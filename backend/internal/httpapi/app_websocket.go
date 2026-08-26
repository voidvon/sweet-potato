package httpapi

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"sweet-potato-go/internal/store"
)

// handleAppWebSocket is the long-lived, server-push channel for application
// events (credits, permissions and background jobs). Interactive chat turns
// continue to use the chat protocol, while sharing the same framing format.
func (s *Server) handleAppWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Upgrade") == "" || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		writeError(w, http.StatusUpgradeRequired, "需要 WebSocket 升级")
		return
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		writeError(w, http.StatusInternalServerError, "当前服务器不支持 WebSocket")
		return
	}
	connection, buffered, err := hijacker.Hijack()
	if err != nil {
		return
	}
	defer connection.Close()
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return
	}
	acceptHash := sha1.Sum([]byte(strings.TrimSpace(key) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	response := "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + base64.StdEncoding.EncodeToString(acceptHash[:]) + "\r\n\r\n"
	if _, err := connection.Write([]byte(response)); err != nil {
		return
	}
	_ = writeWebSocketJSON(connection, map[string]any{"method": "app/connected", "params": map[string]any{}})
	session := &chatWebSocketSession{server: s, connection: connection, user: userFromRequest(r, s)}
	s.registerAppWebSocket(session)
	defer s.unregisterAppWebSocket(session)
	defer session.cancelActive()
	write := session.writeFrame

	// Keep the connection alive and detect client disconnects. Event fan-out is
	// intentionally protocol-shaped so the broker can be attached without
	// changing clients.
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = write(9, nil)
			case <-stop:
				return
			case <-r.Context().Done():
				return
			}
		}
	}()
	defer close(stop)
	for {
		payload, opcode, err := readWebSocketFrame(buffered)
		if err != nil || opcode == 8 {
			return
		}
		if opcode == 9 {
			_ = write(10, payload)
			continue
		}
		if opcode != 1 {
			continue
		}
		var command chatTurnCommand
		if err := json.Unmarshal(payload, &command); err != nil {
			_ = session.writeJSON(chatTurnError(nil, http.StatusBadRequest, "请求格式错误"))
			continue
		}
		if command.Method == "" {
			command.Method = "turn/start"
			command.ID = randomIDForHTTP()
			command.Params = json.RawMessage(payload)
		}
		switch command.Method {
		case "turn/start":
			if !userHasPermission(session.user, "web.module.chat") {
				_ = session.writeJSON(chatTurnError(command.ID, http.StatusForbidden, "当前账号无权访问该功能"))
				continue
			}
			if err := session.startTurn(command); err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, store.ErrChatResponseInProgress) {
					status = http.StatusConflict
				}
				_ = session.writeJSON(chatTurnError(command.ID, status, err.Error()))
			}
		case "turn/interrupt":
			if err := session.interruptTurn(command); err != nil {
				_ = session.writeJSON(chatTurnError(command.ID, http.StatusBadRequest, err.Error()))
			}
		default:
			_ = session.writeJSON(chatTurnError(command.ID, http.StatusNotFound, "不支持的命令"))
		}
	}
}

func userHasPermission(user store.User, permission string) bool {
	if user.Role == "admin" {
		return true
	}
	for _, granted := range user.Permissions {
		if granted == permission {
			return true
		}
	}
	return false
}

func userFromRequest(r *http.Request, s *Server) store.User {
	user, _ := s.authenticatedUser(r)
	return user
}

func (s *Server) registerAppWebSocket(session *chatWebSocketSession) {
	s.appWSMu.Lock()
	defer s.appWSMu.Unlock()
	clients := s.appWSClients[session.user.ID]
	if clients == nil {
		clients = make(map[*chatWebSocketSession]struct{})
		s.appWSClients[session.user.ID] = clients
	}
	clients[session] = struct{}{}
}

func (s *Server) unregisterAppWebSocket(session *chatWebSocketSession) {
	s.appWSMu.Lock()
	defer s.appWSMu.Unlock()
	clients := s.appWSClients[session.user.ID]
	delete(clients, session)
	if len(clients) == 0 {
		delete(s.appWSClients, session.user.ID)
	}
}

func (s *Server) publishAppEvent(userID, method string, params any) {
	s.appWSMu.RLock()
	clients := make([]*chatWebSocketSession, 0, len(s.appWSClients[userID]))
	for client := range s.appWSClients[userID] {
		clients = append(clients, client)
	}
	s.appWSMu.RUnlock()
	for _, client := range clients {
		_ = client.writeJSON(map[string]any{"method": method, "params": params})
	}
}

func writeWebSocketJSON(connection net.Conn, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeWebSocketFrame(connection, 1, payload)
}
