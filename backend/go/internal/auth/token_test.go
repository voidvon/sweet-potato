package auth

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func TestVerifyAcceptsLegacyTokenWithoutAuthVersion(t *testing.T) {
	manager := NewTokenManager("legacy-secret", time.Hour)
	header := encodeSegment(map[string]string{"alg": "HS256", "typ": "JWT"})
	payload := encodeSegment(map[string]any{
		"sub":  "legacy-user",
		"role": "admin",
		"iat":  time.Now().Unix(),
		"exp":  time.Now().Add(time.Hour).Unix(),
	})
	token := header + "." + payload + "." + manager.sign(header+"."+payload)

	claims, err := manager.Verify(token)
	if err != nil {
		t.Fatalf("verify legacy token: %v", err)
	}
	if claims.AuthVersion != 1 {
		t.Fatalf("auth version = %d, want 1", claims.AuthVersion)
	}
}

func TestEncodeSegmentUsesURLSafeJSON(t *testing.T) {
	value := map[string]string{"message": "中文"}
	segment := encodeSegment(value)
	decoded, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil {
		t.Fatalf("decode segment: %v", err)
	}
	var got map[string]string
	if err := json.Unmarshal(decoded, &got); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}
	if got["message"] != value["message"] {
		t.Fatalf("message = %q, want %q", got["message"], value["message"])
	}
}
