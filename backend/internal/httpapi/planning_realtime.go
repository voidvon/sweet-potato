package httpapi

import "sweet-potato-go/internal/store"

const planningSessionUpdatedMethod = "app/content-planning-session-updated"

func (s *Server) publishPlanningSessionUpdated(session store.ContentPlanningSession, operation string) {
	status := session.Status
	switch operation {
	case "campaign-images":
		status = stringValue(objectValue(session.Analysis["campaignImageGeneration"]), "status")
	case "narration":
		status = stringValue(objectValue(session.Analysis["narrationGeneration"]), "status")
	}
	s.publishAppEvent(session.UserID, planningSessionUpdatedMethod, map[string]any{
		"sessionId": session.ID,
		"userId":    session.UserID,
		"operation": operation,
		"status":    status,
		"updatedAt": session.UpdatedAt,
		"session":   session,
	})
}
