package transfer

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const MaxMediaBytes int64 = 2 << 30

func ReadAll(reader io.Reader, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, errors.New("read size limit must be positive")
	}
	value, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(value)) > maxBytes {
		return nil, fmt.Errorf("response exceeds %d byte limit", maxBytes)
	}
	return value, nil
}

func ValidatePublicHTTPURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return errors.New("remote URL is invalid")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "localhost" || isPrivateIP(net.ParseIP(host)) {
		return errors.New("remote URL points to a private address")
	}
	addresses, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("resolve remote URL host: %w", err)
	}
	for _, address := range addresses {
		if isPrivateIP(address) {
			return errors.New("remote URL resolves to a private address")
		}
	}
	return nil
}

func PublicRedirectClient(client *http.Client) *http.Client {
	if client == nil {
		client = http.DefaultClient
	}
	copy := *client
	copy.CheckRedirect = func(request *http.Request, _ []*http.Request) error {
		return ValidatePublicHTTPURL(request.URL.String())
	}
	return &copy
}

// Download writes to a temporary file and renames it only after the complete
// response has been received. This keeps existing assets intact on failure.
func Download(ctx context.Context, client *http.Client, sourceURL, destination string, maxBytes int64) (int64, error) {
	if maxBytes <= 0 {
		return 0, errors.New("download size limit must be positive")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return 0, err
	}
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return 0, fmt.Errorf("download failed, HTTP %d", response.StatusCode)
	}
	if response.ContentLength > maxBytes {
		return 0, fmt.Errorf("download exceeds %d byte limit", maxBytes)
	}

	directory := filepath.Dir(destination)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return 0, err
	}
	temporary, err := os.CreateTemp(directory, "."+filepath.Base(destination)+".*.tmp")
	if err != nil {
		return 0, err
	}
	temporaryName := temporary.Name()
	removeTemporary := true
	defer func() {
		_ = temporary.Close()
		if removeTemporary {
			_ = os.Remove(temporaryName)
		}
	}()

	written, copyErr := io.Copy(temporary, io.LimitReader(response.Body, maxBytes+1))
	closeErr := temporary.Close()
	if copyErr != nil {
		return 0, copyErr
	}
	if closeErr != nil {
		return 0, closeErr
	}
	if written > maxBytes {
		return 0, fmt.Errorf("download exceeds %d byte limit", maxBytes)
	}
	if err := os.Chmod(temporaryName, 0o644); err != nil {
		return 0, err
	}
	if err := os.Rename(temporaryName, destination); err != nil {
		return 0, err
	}
	removeTemporary = false
	return written, nil
}

func isPrivateIP(value net.IP) bool {
	if value == nil {
		return false
	}
	if value4 := value.To4(); value4 != nil {
		return value4[0] == 0 || value4[0] == 10 || value4[0] == 127 || (value4[0] == 169 && value4[1] == 254) || (value4[0] == 172 && value4[1] >= 16 && value4[1] <= 31) || (value4[0] == 192 && value4[1] == 168) || value4[0] >= 224
	}
	return value.IsLoopback() || value.IsPrivate() || value.IsUnspecified() || value.IsLinkLocalUnicast() || value.IsLinkLocalMulticast()
}
