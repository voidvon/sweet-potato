package store

import "testing"

func TestBeginEditedChatResponseReplacesTurnAndTruncatesFollowingMessages(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()

	conversation, err := dataStore.SaveChatConversation(ChatConversation{UserID: "chat-user", AgentID: "quick-answer"}, true)
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	firstUser, firstAssistant, err := dataStore.BeginChatResponse(conversation.UserID, false,
		ChatMessage{ConversationID: conversation.ID, Role: "user", Content: "第一问", AgentID: "quick-answer", IsCompleted: true},
		ChatMessage{ConversationID: conversation.ID, Role: "assistant", AgentID: "quick-answer", IsCompleted: false},
	)
	if err != nil {
		t.Fatalf("begin first response: %v", err)
	}
	firstAssistant.Content = "第一答"
	firstAssistant.IsCompleted = true
	if _, err := dataStore.UpdateChatMessage(firstAssistant); err != nil {
		t.Fatalf("complete first response: %v", err)
	}
	secondUser, secondAssistant, err := dataStore.BeginChatResponse(conversation.UserID, false,
		ChatMessage{ConversationID: conversation.ID, Role: "user", Content: "第二问", AgentID: "quick-answer", IsCompleted: true},
		ChatMessage{ConversationID: conversation.ID, Role: "assistant", AgentID: "quick-answer", IsCompleted: false},
	)
	if err != nil {
		t.Fatalf("begin second response: %v", err)
	}
	secondAssistant.Content = "第二答"
	secondAssistant.IsCompleted = true
	if _, err := dataStore.UpdateChatMessage(secondAssistant); err != nil {
		t.Fatalf("complete second response: %v", err)
	}

	editedUser, _, err := dataStore.BeginEditedChatResponse(conversation.UserID, firstUser.ID,
		ChatMessage{ConversationID: conversation.ID, Role: "user", Content: "修改后的第一问", AgentID: "quick-answer", IsCompleted: true},
		ChatMessage{ConversationID: conversation.ID, Role: "assistant", AgentID: "quick-answer", IsCompleted: false},
	)
	if err != nil {
		t.Fatalf("begin edited response: %v", err)
	}
	if editedUser.ID != firstUser.ID || editedUser.CreatedAt != firstUser.CreatedAt {
		t.Fatalf("edited user identity changed: before=%#v after=%#v", firstUser, editedUser)
	}
	messages, err := dataStore.ListChatMessages(conversation.ID)
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	if len(messages) != 2 || messages[0].Content != "修改后的第一问" || messages[1].Role != "assistant" || messages[1].IsCompleted {
		t.Fatalf("messages after edit = %#v", messages)
	}
	for _, item := range messages {
		if item.ID == secondUser.ID || item.ID == secondAssistant.ID || item.ID == firstAssistant.ID {
			t.Fatalf("stale branch message retained: %#v", item)
		}
	}
}
