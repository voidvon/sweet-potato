package httpapi

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestChatTurnWebSocketInterruptsUpstreamRequest(t *testing.T) {
	upstreamStarted := make(chan struct{})
	upstreamCanceled := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(upstreamStarted)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
		close(upstreamCanceled)
	}))
	defer upstream.Close()

	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "turn-protocol-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("turn-protocol-user", "password123", "Turn Protocol User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := server.store.SaveModelConfig(store.ModelConfig{ID: "turn-protocol-model", Type: "llm", Name: "Turn protocol model", Provider: "openai", Model: "test", APIKey: "test", BaseURL: upstream.URL}, true); err != nil {
		t.Fatalf("save model: %v", err)
	}

	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	connection, err := net.Dial("tcp", strings.TrimPrefix(httpServer.URL, "http://"))
	if err != nil {
		t.Fatalf("dial server: %v", err)
	}
	defer connection.Close()
	token := server.tokens.Create(user.ID, user.Role, user.AuthVersion)
	_, _ = fmt.Fprintf(connection, "GET /api/chat/messages/ws HTTP/1.1\r\nHost: test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGVzdC13ZWJzb2NrZXQta2V5\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer %s\r\n\r\n", token)
	reader := bufio.NewReader(connection)
	statusLine, err := reader.ReadString('\n')
	if err != nil || !strings.Contains(statusLine, "101") {
		t.Fatalf("handshake status = %q, err = %v", statusLine, err)
	}
	for {
		line, readErr := reader.ReadString('\n')
		if readErr != nil {
			t.Fatalf("read handshake: %v", readErr)
		}
		if line == "\r\n" {
			break
		}
	}

	start := map[string]any{"method": "turn/start", "id": "turn-1", "params": map[string]any{"agentId": "quick-answer", "modelConfigId": "turn-protocol-model", "content": "请回答"}}
	startPayload, _ := json.Marshal(start)
	if err := writeWebSocketFrame(connection, 1, startPayload); err != nil {
		t.Fatalf("write turn/start: %v", err)
	}
	readTurnFrame(t, reader) // turn/start response
	readTurnFrame(t, reader) // turn/started notification
	select {
	case <-upstreamStarted:
	case <-time.After(time.Second):
		t.Fatal("upstream request did not start")
	}

	interruptPayload, _ := json.Marshal(map[string]any{"method": "turn/interrupt", "id": "interrupt-1", "params": map[string]any{"turnId": "turn-1"}})
	if err := writeWebSocketFrame(connection, 1, interruptPayload); err != nil {
		t.Fatalf("write turn/interrupt: %v", err)
	}
	interruptResponse := readTurnFrame(t, reader)
	if interruptResponse["id"] != "interrupt-1" || interruptResponse["error"] != nil {
		t.Fatalf("interrupt response = %#v", interruptResponse)
	}
	completed := readTurnFrame(t, reader)
	if completed["method"] != "turn/completed" {
		t.Fatalf("completed event = %#v", completed)
	}
	params, _ := completed["params"].(map[string]any)
	turn, _ := params["turn"].(map[string]any)
	if turn["status"] != "interrupted" {
		t.Fatalf("turn = %#v", turn)
	}
	select {
	case <-upstreamCanceled:
	case <-time.After(time.Second):
		t.Fatal("upstream request was not canceled")
	}
}

func readTurnFrame(t *testing.T, reader *bufio.Reader) map[string]any {
	t.Helper()
	payload, opcode, err := readWebSocketFrame(reader)
	if err != nil {
		t.Fatalf("read websocket frame: %v", err)
	}
	if opcode != 1 {
		t.Fatalf("opcode = %d, want text", opcode)
	}
	var value map[string]any
	if err := json.Unmarshal(payload, &value); err != nil {
		t.Fatalf("decode websocket frame: %v", err)
	}
	return value
}
