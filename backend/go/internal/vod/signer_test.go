package vod

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSignV4IsDeterministic(t *testing.T) {
	now := time.Date(2026, time.August, 19, 8, 9, 10, 0, time.UTC)
	request, err := http.NewRequest(http.MethodGet, "https://vod.example.com/?z=last&Action=Apply Upload Info", nil)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	request.Header.Set("X-Custom", "  value   with spaces ")
	signV4(request, []byte("body"), "access", "secret", "cn-north-1", "vod", now)

	if request.Header.Get("X-Date") != "20260819T080910Z" {
		t.Fatalf("unexpected date: %s", request.Header.Get("X-Date"))
	}
	if request.Header.Get("X-Content-Sha256") != sha256Hex([]byte("body")) {
		t.Fatalf("unexpected body hash: %s", request.Header.Get("X-Content-Sha256"))
	}
	authorization := request.Header.Get("Authorization")
	if !strings.Contains(authorization, "Credential=access/20260819/cn-north-1/vod/request") {
		t.Fatalf("unexpected credential scope: %s", authorization)
	}
	if !strings.Contains(authorization, "SignedHeaders=host;x-content-sha256;x-custom;x-date") {
		t.Fatalf("unexpected signed headers: %s", authorization)
	}
	if !strings.Contains(authorization, "Signature=") {
		t.Fatalf("missing signature: %s", authorization)
	}
	if canonicalQuery(request.URL.Query()) != "Action=Apply%20Upload%20Info&z=last" {
		t.Fatalf("unexpected canonical query: %s", canonicalQuery(request.URL.Query()))
	}
}

func TestCanonicalQuerySortsAndEscapesValues(t *testing.T) {
	values := map[string][]string{"b": {"two", "one"}, "a": {"a+b"}}
	if got := canonicalQuery(values); got != "a=a%2Bb&b=one&b=two" {
		t.Fatalf("canonical query = %s", got)
	}
}
