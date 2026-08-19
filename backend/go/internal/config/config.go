package config

import (
	"bufio"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr               string
	DataDir            string
	AuthTokenSecret    string
	AuthTokenExpiresIn time.Duration
}

func Load() Config {
	loadDotEnv()

	if configuredAddr := strings.TrimSpace(os.Getenv("GO_SERVER_ADDR")); configuredAddr != "" {
		return Config{
			Addr:               configuredAddr,
			DataDir:            resolveDataDir(os.Getenv("DATA_DIR")),
			AuthTokenSecret:    authTokenSecret(),
			AuthTokenExpiresIn: authTokenExpiry(),
		}
	}

	host := strings.TrimSpace(os.Getenv("GO_SERVER_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "7072"
	}
	if parsed, err := strconv.Atoi(port); err != nil || parsed < 1 || parsed > 65535 {
		port = "7072"
	}

	return Config{
		Addr:               net.JoinHostPort(host, port),
		DataDir:            resolveDataDir(os.Getenv("DATA_DIR")),
		AuthTokenSecret:    authTokenSecret(),
		AuthTokenExpiresIn: authTokenExpiry(),
	}
}

func authTokenSecret() string {
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("AUTH_TOKEN_SECRET"))
	}
	if secret == "" {
		secret = "ai-marketing-desktop-server-dev-secret"
	}
	return secret
}

func authTokenExpiry() time.Duration {
	seconds := 30 * 24 * 60 * 60
	if value, err := strconv.Atoi(strings.TrimSpace(os.Getenv("JWT_EXPIRES_IN_SECONDS"))); err == nil && value > 0 {
		seconds = value
	}
	return time.Duration(seconds) * time.Second
}

func resolveDataDir(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = "data"
	}
	if absolute, err := filepath.Abs(value); err == nil {
		return absolute
	}
	return filepath.Clean(value)
}

func loadDotEnv() {
	candidates := []string{}
	if configured := strings.TrimSpace(os.Getenv("ENV_FILE")); configured != "" {
		candidates = append(candidates, configured)
	}
	candidates = append(candidates, ".env", filepath.Join("config", ".env"), filepath.Join("backend", "go", ".env"))

	for _, candidate := range candidates {
		if loadDotEnvFile(candidate) {
			return
		}
	}
}

func loadDotEnvFile(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" || os.Getenv(key) != "" {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && ((value[0] == '\'' && value[len(value)-1] == '\'') || (value[0] == '"' && value[len(value)-1] == '"')) {
			value = value[1 : len(value)-1]
		}
		_ = os.Setenv(key, value)
	}
	return true
}
