package httpapi

import (
	"net/http"
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestCreateChatMessageReturnsConflictWhileAssistantIsPending(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("chat-conflict-user", "password123", "Chat Conflict User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	conversation, err := server.store.SaveChatConversation(store.ChatConversation{
		UserID:  user.ID,
		AgentID: "quick-answer",
		Title:   "处理中会话",
	}, true)
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if _, _, err := server.store.BeginChatResponse(user.ID, false,
		store.ChatMessage{ConversationID: conversation.ID, Role: "user", Content: "第一条", AgentID: "quick-answer", IsCompleted: true},
		store.ChatMessage{ConversationID: conversation.ID, Role: "assistant", AgentID: "quick-answer", IsCompleted: false},
	); err != nil {
		t.Fatalf("begin pending response: %v", err)
	}

	response := requestJSONWithHeaders(t, server, http.MethodPost, "/api/chat/messages", map[string]any{
		"conversationId":        conversation.ID,
		"content":               "第二条",
		"requestedCapabilities": []string{"image_generation"},
	}, server.tokens.Create(user.ID, user.Role, user.AuthVersion))
	if response.Code != http.StatusConflict {
		t.Fatalf("create message status = %d, want %d: %s", response.Code, http.StatusConflict, response.Body.String())
	}
	messages, err := server.store.ListChatMessages(conversation.ID)
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("rejected request persisted messages: %#v", messages)
	}
}
