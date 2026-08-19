package vod

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

func signV4(request *http.Request, body []byte, accessKey, secretKey, region, service string, now time.Time) {
	formatDate := now.UTC().Format("20060102T150405Z")
	shortDate := formatDate[:8]
	bodyHash := sha256Hex(body)
	request.Header.Set("X-Date", formatDate)
	request.Header.Set("X-Content-Sha256", bodyHash)

	host := request.Host
	if host == "" {
		host = request.URL.Host
	}
	canonicalHeaders, signedHeaders := canonicalHeaders(request.Header, host)
	canonicalRequest := strings.Join([]string{
		request.Method,
		canonicalURI(request.URL),
		canonicalQuery(request.URL.Query()),
		canonicalHeaders,
		signedHeaders,
		bodyHash,
	}, "\n")
	credentialScope := strings.Join([]string{shortDate, region, service, "request"}, "/")
	stringToSign := strings.Join([]string{
		"HMAC-SHA256",
		formatDate,
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signatureKey := hmacSum(hmacSum(hmacSum(hmacSum([]byte(secretKey), []byte(shortDate)), []byte(region)), []byte(service)), []byte("request"))
	signature := hex.EncodeToString(hmacSum(signatureKey, []byte(stringToSign)))
	request.Header.Set("Authorization", "HMAC-SHA256 Credential="+accessKey+"/"+credentialScope+", SignedHeaders="+signedHeaders+", Signature="+signature)
}

func canonicalHeaders(headers http.Header, host string) (string, string) {
	values := map[string]string{"host": normalizeHeaderValue(host)}
	for name, list := range headers {
		lower := strings.ToLower(strings.TrimSpace(name))
		if lower != "content-type" && lower != "content-md5" && !strings.HasPrefix(lower, "x-") {
			continue
		}
		values[lower] = normalizeHeaderValue(strings.Join(list, ","))
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var builder strings.Builder
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteByte(':')
		builder.WriteString(values[key])
		builder.WriteByte('\n')
	}
	return builder.String(), strings.Join(keys, ";")
}

func canonicalURI(value *url.URL) string {
	if value == nil || value.EscapedPath() == "" {
		return "/"
	}
	return value.EscapedPath()
}

func canonicalQuery(values url.Values) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var parts []string
	for _, key := range keys {
		items := append([]string(nil), values[key]...)
		sort.Strings(items)
		if len(items) == 0 {
			parts = append(parts, rfc3986Escape(key)+"=")
			continue
		}
		for _, item := range items {
			parts = append(parts, rfc3986Escape(key)+"="+rfc3986Escape(item))
		}
	}
	return strings.Join(parts, "&")
}

func rfc3986Escape(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

func normalizeHeaderValue(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func sha256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func hmacSum(key, value []byte) []byte {
	hash := hmac.New(sha256.New, key)
	_, _ = hash.Write(value)
	return hash.Sum(nil)
}
