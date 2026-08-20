package httpapi

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"sweet-potato-go/internal/store"
)

type rateLimitWindow struct {
	StartedAt time.Time
	Count     int
}

type authenticatedUserContextKey struct{}

func withAuthenticatedUser(ctx context.Context, user store.User) context.Context {
	return context.WithValue(ctx, authenticatedUserContextKey{}, user)
}

func (s *Server) applyRequestGuards(w http.ResponseWriter, r *http.Request) (int, bool) {
	ip := clientIP(r)
	if s.isIPBlacklistedCached(ip) {
		writeError(w, http.StatusForbidden, "当前 IP 暂时无法访问")
		return http.StatusForbidden, false
	}
	user, authenticated := s.authenticatedUser(r)
	if retryAfter, limited := s.checkRateLimit(r, ip, user, authenticated); limited {
		w.Header().Set("Retry-After", retryAfter)
		writeError(w, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
		return http.StatusTooManyRequests, false
	}
	return 0, true
}

func (s *Server) checkRateLimit(r *http.Request, ip string, user store.User, authenticated bool) (string, bool) {
	rules := s.cachedRateRules()
	now := time.Now()
	for _, rule := range rules {
		matched, err := regexp.MatchString(rule.URLPattern, r.URL.Path)
		if err != nil || !matched {
			continue
		}
		if (rule.TargetUser == "authenticated" && !authenticated) || (rule.TargetUser == "anonymous" && authenticated) {
			continue
		}
		identity := ip
		if authenticated {
			identity = user.ID
		}
		key := rule.ID + ":" + identity
		s.rateMu.Lock()
		window := s.rateWindows[key]
		interval := time.Duration(rule.IntervalSeconds) * time.Second
		if window.StartedAt.IsZero() || now.Sub(window.StartedAt) >= interval {
			window = rateLimitWindow{StartedAt: now}
		}
		window.Count++
		s.rateWindows[key] = window
		s.rateMu.Unlock()
		if window.Count > rule.MaxRequests {
			remaining := interval - now.Sub(window.StartedAt)
			if remaining < time.Second {
				remaining = time.Second
			}
			return strconv.Itoa(int(remaining/time.Second) + 1), true
		}
	}
	return "", false
}

func (s *Server) cachedRateRules() []store.RateLimitRule {
	s.rateMu.Lock()
	if time.Since(s.rateLoadedAt) < 2*time.Second {
		rules := append([]store.RateLimitRule(nil), s.rateRules...)
		s.rateMu.Unlock()
		return rules
	}
	s.rateMu.Unlock()
	rules, err := s.store.ListRateLimitRules()
	if err != nil {
		return nil
	}
	s.rateMu.Lock()
	s.rateRules = append([]store.RateLimitRule(nil), rules...)
	s.rateLoadedAt = time.Now()
	s.rateMu.Unlock()
	return rules
}

func (s *Server) isIPBlacklistedCached(ip string) bool {
	s.ipMu.Lock()
	if time.Since(s.ipLoadedAt) >= 2*time.Second {
		s.ipMu.Unlock()
		settings, err := s.store.GetIPBlacklist(ip)
		if err != nil {
			return false
		}
		s.ipMu.Lock()
		s.ipRules = append([]string(nil), settings.Entries...)
		s.ipLoadedAt = time.Now()
	}
	rules := append([]string(nil), s.ipRules...)
	s.ipMu.Unlock()
	for _, rule := range rules {
		pattern := "^" + strings.ReplaceAll(regexp.QuoteMeta(rule), `\*`, ".*") + "$"
		matched, _ := regexp.MatchString(pattern, ip)
		if matched {
			return true
		}
	}
	return false
}

func (s *Server) recordAccess(w http.ResponseWriter, r *http.Request, startedAt time.Time, status int, user store.User) {
	if r.Method == http.MethodOptions {
		return
	}
	if err := s.store.CreateAccessLog(store.AccessLog{
		IP: clientIP(r), UserID: user.ID, Username: user.Username, Method: r.Method,
		Path: r.URL.Path, UserAgent: r.UserAgent(), StatusCode: status,
		DurationMS: time.Since(startedAt).Milliseconds(), AccessedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}); err != nil {
		return
	}
	count := s.accessCount.Add(1)
	if count%100 == 0 {
		_ = s.store.PruneAccessLogs()
	}
	_ = w
}

type statusResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusResponseWriter) ResponseLanguage() string {
	return responseLanguage(w.ResponseWriter)
}

func (w *statusResponseWriter) Flush() {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *statusResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func (w *statusResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusResponseWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}
