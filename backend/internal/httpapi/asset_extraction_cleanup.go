package httpapi

import (
	"log/slog"
	"time"
)

func (s *Server) runAssetExtractionCleanupLoop() {
	s.cleanupAssetExtractionHistory()
	for {
		interval := time.Hour
		if settings, err := s.store.GetTemporaryAssetCleanupSettings(); err == nil && settings.CleanupIntervalMinutes > 0 {
			interval = time.Duration(settings.CleanupIntervalMinutes) * time.Minute
		}
		timer := time.NewTimer(interval)
		select {
		case <-s.taskContext().Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
			s.cleanupAssetExtractionHistory()
		}
	}
}

func (s *Server) cleanupAssetExtractionHistory() {
	stats, err := s.store.CleanupAssetExtractions(time.Now().UTC())
	if err != nil {
		slog.Warn("asset extraction cleanup failed", "error", err)
		return
	}
	if stats.StaleFailed+stats.OrphansDeleted+stats.FailuresDeleted+stats.SupersededDeleted+stats.HistoryCapDeleted > 0 {
		slog.Info("asset extraction cleanup completed", "stats", stats)
	}
}
