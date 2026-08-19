package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type Claims struct {
	Subject     string `json:"sub"`
	Role        string `json:"role"`
	AuthVersion int    `json:"authVersion"`
	IssuedAt    int64  `json:"iat"`
	ExpiresAt   int64  `json:"exp"`
}

type TokenManager struct {
	secret []byte
	ttl    time.Duration
}

func NewTokenManager(secret string, ttl time.Duration) *TokenManager {
	if strings.TrimSpace(secret) == "" {
		secret = "ai-marketing-desktop-server-dev-secret"
	}
	if ttl <= 0 {
		ttl = 30 * 24 * time.Hour
	}
	return &TokenManager{secret: []byte(secret), ttl: ttl}
}

func (m *TokenManager) Create(userID string, role string, authVersion int) string {
	now := time.Now().Unix()
	claims := Claims{
		Subject:     userID,
		Role:        role,
		AuthVersion: authVersion,
		IssuedAt:    now,
		ExpiresAt:   now + int64(m.ttl/time.Second),
	}
	header := encodeSegment(map[string]string{"alg": "HS256", "typ": "JWT"})
	payload := encodeSegment(claims)
	unsigned := header + "." + payload
	return unsigned + "." + m.sign(unsigned)
}

func (m *TokenManager) Verify(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, errors.New("invalid token format")
	}
	unsigned := parts[0] + "." + parts[1]
	if subtle.ConstantTimeCompare([]byte(parts[2]), []byte(m.sign(unsigned))) != 1 {
		return Claims{}, errors.New("invalid token signature")
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, fmt.Errorf("decode token header: %w", err)
	}
	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Algorithm != "HS256" || header.Type != "JWT" {
		return Claims{}, errors.New("invalid token header")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, fmt.Errorf("decode token payload: %w", err)
	}
	var claims Claims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return Claims{}, fmt.Errorf("decode token claims: %w", err)
	}
	if claims.AuthVersion == 0 {
		claims.AuthVersion = 1
	}
	if claims.Subject == "" || (claims.Role != "admin" && claims.Role != "user") || claims.IssuedAt <= 0 || claims.ExpiresAt <= time.Now().Unix() {
		return Claims{}, errors.New("expired or invalid token claims")
	}
	return claims, nil
}

func (m *TokenManager) sign(value string) string {
	hash := hmac.New(sha256.New, m.secret)
	_, _ = hash.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(hash.Sum(nil))
}

func encodeSegment(value any) string {
	bytes, _ := json.Marshal(value)
	return base64.RawURLEncoding.EncodeToString(bytes)
}

func ExtractBearer(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 7 && strings.EqualFold(value[:7], "Bearer ") {
		return strings.TrimSpace(value[7:])
	}
	return value
}
