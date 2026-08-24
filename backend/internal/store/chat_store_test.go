package store

import (
	"errors"
	"strings"
	"testing"
)

func TestBeginChatResponseRejectsConcurrentTurn(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()

	conversation, err := dataStore.SaveChatConversation(ChatConversation{
		UserID:  "chat-user",
		AgentID: "quick-answer",
		Title:   "并发测试",
	}, true)
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	userMessage := ChatMessage{ConversationID: conversation.ID, Role: "user", Content: "第一条", AgentID: "quick-answer", IsCompleted: true}
	assistantMessage := ChatMessage{ConversationID: conversation.ID, Role: "assistant", AgentID: "quick-answer", IsCompleted: false}
	_, pendingAssistant, err := dataStore.BeginChatResponse(conversation.UserID, false, userMessage, assistantMessage)
	if err != nil {
		t.Fatalf("begin first response: %v", err)
	}

	_, _, err = dataStore.BeginChatResponse(conversation.UserID, false,
		ChatMessage{ConversationID: conversation.ID, Role: "user", Content: "第二条", AgentID: "quick-answer", IsCompleted: true},
		ChatMessage{ConversationID: conversation.ID, Role: "assistant", AgentID: "quick-answer", IsCompleted: false},
	)
	if !errors.Is(err, ErrChatResponseInProgress) {
		t.Fatalf("concurrent response error = %v, want ErrChatResponseInProgress", err)
	}
	messages, err := dataStore.ListChatMessages(conversation.ID)
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	if len(messages) != 2 || messages[1].ID != pendingAssistant.ID || messages[1].IsCompleted {
		t.Fatalf("messages after rejected turn = %#v", messages)
	}

	pendingAssistant.Content = "第一条回复"
	pendingAssistant.IsCompleted = true
	if _, err := dataStore.UpdateChatMessage(pendingAssistant); err != nil {
		t.Fatalf("complete first response: %v", err)
	}
	if _, _, err := dataStore.BeginChatResponse(conversation.UserID, false,
		ChatMessage{ConversationID: conversation.ID, Role: "user", Content: "第二条", AgentID: "quick-answer", IsCompleted: true},
		ChatMessage{ConversationID: conversation.ID, Role: "assistant", AgentID: "quick-answer", IsCompleted: false},
	); err != nil {
		t.Fatalf("begin response after completion: %v", err)
	}
}

func TestOpenRecoversInterruptedChatResponse(t *testing.T) {
	dataDir := t.TempDir()
	dataStore, err := Open(dataDir)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	conversation, err := dataStore.SaveChatConversation(ChatConversation{UserID: "chat-user", AgentID: "quick-answer"}, true)
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	_, pendingAssistant, err := dataStore.BeginChatResponse(conversation.UserID, false,
		ChatMessage{ConversationID: conversation.ID, Role: "user", Content: "生成图片", AgentID: "quick-answer", IsCompleted: true},
		ChatMessage{ConversationID: conversation.ID, Role: "assistant", AgentID: "quick-answer", IsCompleted: false},
	)
	if err != nil {
		t.Fatalf("begin response: %v", err)
	}
	if err := dataStore.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	dataStore, err = Open(dataDir)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	defer dataStore.Close()
	recovered, found, err := dataStore.FindChatMessage(pendingAssistant.ID)
	if err != nil || !found {
		t.Fatalf("find recovered response: found=%v err=%v", found, err)
	}
	if !recovered.IsCompleted || !strings.Contains(recovered.Content, "已中断") {
		t.Fatalf("recovered response = %#v", recovered)
	}
}
