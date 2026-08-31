package pluginruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const RemotionPluginKey = "lightweight-marketing-video"

var (
	ErrNotInstalled   = errors.New("Remotion 插件运行包未安装")
	ErrNotRunning     = errors.New("Remotion 插件未启用或尚未就绪")
	ErrRenderNotFound = errors.New("Remotion 渲染任务不存在")
	ErrUnsupported    = errors.New("不支持的插件")
)

type RenderJob struct {
	ID          string  `json:"id"`
	Status      string  `json:"status"`
	Progress    float64 `json:"progress"`
	CreatedAt   string  `json:"createdAt"`
	StartedAt   string  `json:"startedAt,omitempty"`
	CompletedAt string  `json:"completedAt,omitempty"`
	VideoURL    string  `json:"videoUrl,omitempty"`
	Error       string  `json:"error,omitempty"`
}

type Status struct {
	Installed       bool   `json:"installed"`
	State           string `json:"state"`
	Endpoint        string `json:"endpoint,omitempty"`
	PID             int    `json:"pid,omitempty"`
	StartedAt       string `json:"startedAt,omitempty"`
	LastError       string `json:"lastError,omitempty"`
	PluginDir       string `json:"pluginDir,omitempty"`
	BunVersion      string `json:"bunVersion,omitempty"`
	InstallStage    string `json:"installStage,omitempty"`
	DownloadedBytes int64  `json:"downloadedBytes,omitempty"`
	TotalBytes      int64  `json:"totalBytes,omitempty"`
	CanUninstall    bool   `json:"canUninstall,omitempty"`
}

type Manager struct {
	mu          sync.RWMutex
	pluginDir   string
	bunPath     string
	dataDir     string
	status      Status
	command     *exec.Cmd
	processDone chan struct{}
	cancelWait  context.CancelFunc
	generation  uint64
	desired     bool
	concurrency int
	restarts    int
	installing  bool
}

func New(dataDir string) *Manager {
	pluginDir := resolvePluginDir(dataDir)
	bunPath := resolveBunPath(pluginDir)
	manager := &Manager{pluginDir: pluginDir, bunPath: bunPath, dataDir: dataDir}
	manager.status = manager.inspectInstallation()
	return manager
}

func (m *Manager) StartEnabled(enabled bool, maxConcurrency int) {
	if enabled {
		if err := m.Start(RemotionPluginKey, maxConcurrency); err != nil {
			slog.Warn("start managed Remotion plugin failed", "error", err)
		}
	}
}

func (m *Manager) Status(key string) Status {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if key != RemotionPluginKey {
		return Status{State: "unsupported", LastError: ErrUnsupported.Error()}
	}
	return m.status
}

func (m *Manager) Start(key string, maxConcurrency int) error {
	if key != RemotionPluginKey {
		return ErrUnsupported
	}
	m.mu.Lock()
	m.desired = true
	if maxConcurrency < 1 {
		maxConcurrency = 1
	}
	m.concurrency = maxConcurrency
	if m.command != nil && m.command.Process != nil {
		m.mu.Unlock()
		return nil
	}
	m.status = m.inspectInstallation()
	if !m.status.Installed {
		m.status.State = "not_installed"
		m.status.LastError = ErrNotInstalled.Error()
		m.mu.Unlock()
		return ErrNotInstalled
	}
	port, err := availablePort()
	if err != nil {
		m.status.State = "error"
		m.status.LastError = err.Error()
		m.mu.Unlock()
		return err
	}
	endpoint := "http://127.0.0.1:" + strconv.Itoa(port)
	rendersDir := m.rendersDir()
	if err := os.MkdirAll(rendersDir, 0o700); err != nil {
		m.status.State = "error"
		m.status.LastError = err.Error()
		m.mu.Unlock()
		return fmt.Errorf("create Remotion renders directory: %w", err)
	}
	command := exec.Command(m.bunPath, "run", "server:start")
	command.Dir = m.pluginDir
	command.Env = append(os.Environ(),
		"PORT="+strconv.Itoa(port),
		"HOST=127.0.0.1",
		"RENDERS_DIR="+rendersDir,
		"CORS_ORIGIN=",
		"MAX_CONCURRENT_RENDERS="+strconv.Itoa(maxConcurrency),
	)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	configureProcessGroup(command)
	if err := command.Start(); err != nil {
		m.status.State = "error"
		m.status.LastError = err.Error()
		m.mu.Unlock()
		return fmt.Errorf("start Remotion process: %w", err)
	}
	m.generation++
	generation := m.generation
	waitContext, cancelWait := context.WithCancel(context.Background())
	m.cancelWait = cancelWait
	m.command = command
	processDone := make(chan struct{})
	m.processDone = processDone
	m.status.State = "starting"
	m.status.Endpoint = endpoint
	m.status.PID = command.Process.Pid
	m.status.StartedAt = time.Now().UTC().Format(time.RFC3339Nano)
	m.status.LastError = ""
	m.mu.Unlock()

	go m.waitForReady(waitContext, generation, endpoint)
	go m.waitForExit(generation, command, processDone)
	return nil
}

func (m *Manager) rendersDir() string {
	return filepath.Join(m.dataDir, "plugin-data", "remotion-video", "renders")
}

func (m *Manager) Stop(key string) error {
	if key != RemotionPluginKey {
		return ErrUnsupported
	}
	m.mu.Lock()
	m.desired = false
	command := m.command
	processDone := m.processDone
	if command == nil || command.Process == nil {
		m.status.State = disabledState(m.status.Installed)
		m.status.Endpoint = ""
		m.status.PID = 0
		m.status.StartedAt = ""
		m.status.LastError = ""
		m.mu.Unlock()
		return nil
	}
	m.generation++
	m.status.State = "stopping"
	if m.cancelWait != nil {
		m.cancelWait()
	}
	m.command = nil
	m.processDone = nil
	m.mu.Unlock()

	stopProcessGroup(command)
	select {
	case <-processDone:
	case <-time.After(3 * time.Second):
		killProcessGroup(command)
		<-processDone
	}
	m.mu.Lock()
	m.status.State = disabledState(m.status.Installed)
	m.status.Endpoint = ""
	m.status.PID = 0
	m.status.StartedAt = ""
	m.status.LastError = ""
	m.mu.Unlock()
	return nil
}

func (m *Manager) Close() error {
	return m.Stop(RemotionPluginKey)
}

func (m *Manager) Health(ctx context.Context, key string) (time.Duration, any, error) {
	status := m.Status(key)
	if status.State != "running" || status.Endpoint == "" {
		return 0, nil, fmt.Errorf("Remotion 插件未运行，当前状态：%s", status.State)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, status.Endpoint+"/health", nil)
	if err != nil {
		return 0, nil, err
	}
	startedAt := time.Now()
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	latency := time.Since(startedAt)
	if err != nil {
		return latency, nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return latency, nil, fmt.Errorf("健康检查返回 HTTP %d", response.StatusCode)
	}
	return latency, map[string]any{"status": "ok"}, nil
}

func (m *Manager) Capabilities(ctx context.Context, key string) (map[string]any, error) {
	return m.requestJSON(ctx, key, http.MethodGet, "/capabilities", nil)
}

func (m *Manager) Validate(ctx context.Context, key string, payload any) (map[string]any, error) {
	return m.requestJSON(ctx, key, http.MethodPost, "/validate", payload)
}

func (m *Manager) SubmitRender(ctx context.Context, key string, payload any) (string, error) {
	result, err := m.requestJSON(ctx, key, http.MethodPost, "/renders", payload)
	if err != nil {
		return "", err
	}
	jobID, _ := result["jobId"].(string)
	if strings.TrimSpace(jobID) == "" {
		return "", errors.New("Remotion 插件没有返回渲染任务 ID")
	}
	return jobID, nil
}

func (m *Manager) RenderStatus(ctx context.Context, key, jobID string) (RenderJob, error) {
	result, err := m.requestJSON(ctx, key, http.MethodGet, "/renders/"+url.PathEscape(jobID), nil)
	if err != nil {
		return RenderJob{}, err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return RenderJob{}, err
	}
	var job RenderJob
	if err := json.Unmarshal(encoded, &job); err != nil {
		return RenderJob{}, err
	}
	return job, nil
}

func (m *Manager) CancelRender(ctx context.Context, key, jobID string) error {
	_, err := m.requestJSON(ctx, key, http.MethodDelete, "/renders/"+url.PathEscape(jobID), nil)
	return err
}

func (m *Manager) DownloadRender(ctx context.Context, key, jobID string, destination io.Writer) (int64, error) {
	if key != RemotionPluginKey {
		return 0, ErrUnsupported
	}
	status := m.Status(key)
	if status.State != "running" || status.Endpoint == "" {
		return 0, fmt.Errorf("%w，当前状态：%s", ErrNotRunning, status.State)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, status.Endpoint+"/renders/"+url.PathEscape(jobID)+"/video", nil)
	if err != nil {
		return 0, err
	}
	response, err := (&http.Client{Timeout: 2 * time.Hour}).Do(request)
	if err != nil {
		return 0, fmt.Errorf("download Remotion video: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return 0, ErrRenderNotFound
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return 0, fmt.Errorf("Remotion 视频下载返回 HTTP %d", response.StatusCode)
	}
	written, err := io.Copy(destination, io.LimitReader(response.Body, 2<<30))
	if err != nil {
		return written, fmt.Errorf("copy Remotion video: %w", err)
	}
	return written, nil
}

func (m *Manager) requestJSON(ctx context.Context, key, method, requestPath string, payload any) (map[string]any, error) {
	if key != RemotionPluginKey {
		return nil, ErrUnsupported
	}
	status := m.Status(key)
	if status.State != "running" || status.Endpoint == "" {
		return nil, fmt.Errorf("%w，当前状态：%s", ErrNotRunning, status.State)
	}
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("encode Remotion request: %w", err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, status.Endpoint+requestPath, body)
	if err != nil {
		return nil, err
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(request)
	if err != nil {
		return nil, fmt.Errorf("request Remotion plugin: %w", err)
	}
	defer response.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode Remotion response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := result["message"].(string)
		if strings.TrimSpace(message) == "" {
			message = fmt.Sprintf("Remotion 插件返回 HTTP %d", response.StatusCode)
		}
		if issues, ok := result["issues"]; ok {
			if encoded, encodeErr := json.Marshal(issues); encodeErr == nil {
				message += "：" + string(encoded)
			}
		}
		if response.StatusCode == http.StatusNotFound && strings.Contains(strings.ToLower(message), "job") {
			return result, fmt.Errorf("%w: %s", ErrRenderNotFound, message)
		}
		return result, errors.New(message)
	}
	return result, nil
}

func (m *Manager) waitForReady(ctx context.Context, generation uint64, endpoint string) {
	client := &http.Client{Timeout: time.Second}
	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/health", nil)
		response, err := client.Do(request)
		if err == nil {
			response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				m.mu.Lock()
				if m.generation == generation && m.command != nil {
					m.status.State = "running"
					m.restarts = 0
				}
				m.mu.Unlock()
				return
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
	m.mu.Lock()
	var command *exec.Cmd
	if m.generation == generation && m.command != nil {
		m.status.State = "error"
		m.status.LastError = "Remotion 服务启动超时"
		command = m.command
	}
	m.mu.Unlock()
	if command != nil {
		stopProcessGroup(command)
	}
}

func (m *Manager) waitForExit(generation uint64, command *exec.Cmd, processDone chan struct{}) {
	err := command.Wait()
	close(processDone)
	m.mu.Lock()
	if m.generation != generation || m.command != command {
		m.mu.Unlock()
		return
	}
	m.command = nil
	if m.cancelWait != nil {
		m.cancelWait()
	}
	m.status.State = "error"
	m.status.PID = 0
	m.status.Endpoint = ""
	if err != nil {
		m.status.LastError = "Remotion 子进程异常退出：" + err.Error()
	} else {
		m.status.LastError = "Remotion 子进程已退出"
	}
	shouldRestart := m.desired
	m.restarts++
	restartAttempt := m.restarts
	concurrency := m.concurrency
	m.mu.Unlock()
	if shouldRestart {
		delay := time.Duration(1<<min(restartAttempt-1, 5)) * time.Second
		go func() {
			time.Sleep(delay)
			m.mu.RLock()
			stillDesired := m.desired && m.command == nil
			m.mu.RUnlock()
			if stillDesired {
				_ = m.Start(RemotionPluginKey, concurrency)
			}
		}()
	}
}

func (m *Manager) inspectInstallation() Status {
	managed := filepath.Join(m.dataDir, "plugins", "remotion-video")
	status := Status{
		State: "not_installed", PluginDir: m.pluginDir,
		CanUninstall: filepath.Clean(m.pluginDir) == filepath.Clean(managed),
	}
	if m.pluginDir == "" || m.bunPath == "" {
		return status
	}
	if info, err := os.Stat(filepath.Join(m.pluginDir, "package.json")); err != nil || info.IsDir() {
		return status
	}
	if info, err := os.Stat(filepath.Join(m.pluginDir, "node_modules")); err != nil || !info.IsDir() {
		return status
	}
	if info, err := os.Stat(filepath.Join(m.pluginDir, "node_modules", ".remotion", "chrome-headless-shell")); err != nil || !info.IsDir() {
		return status
	}
	output, err := exec.Command(m.bunPath, "--version").Output()
	if err != nil {
		return status
	}
	status.Installed = true
	status.State = "stopped"
	status.BunVersion = strings.TrimSpace(string(output))
	return status
}

func resolvePluginDir(dataDir string) string {
	if configured := strings.TrimSpace(os.Getenv("REMOTION_PLUGIN_DIR")); configured != "" {
		if absolute, err := filepath.Abs(configured); err == nil {
			return absolute
		}
		return filepath.Clean(configured)
	}
	managed := filepath.Join(dataDir, "plugins", "remotion-video")
	if info, statErr := os.Stat(filepath.Join(managed, "package.json")); statErr == nil && !info.IsDir() {
		return managed
	}
	executable, err := os.Executable()
	if err != nil {
		return managed
	}
	bundled := filepath.Join(filepath.Dir(executable), "plugins", "remotion-video")
	if info, statErr := os.Stat(filepath.Join(bundled, "package.json")); statErr == nil && !info.IsDir() {
		return bundled
	}
	return managed
}

func resolveBunPath(pluginDir string) string {
	if configured := strings.TrimSpace(os.Getenv("REMOTION_BUN_PATH")); configured != "" {
		return configured
	}
	name := "bun"
	if runtime.GOOS == "windows" {
		name = "bun.exe"
	}
	for _, candidate := range []string{
		filepath.Join(pluginDir, "bin", name),
		filepath.Join(pluginDir, name),
	} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	path, _ := exec.LookPath(name)
	return path
}

func availablePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("allocate Remotion port: %w", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func disabledState(installed bool) string {
	if installed {
		return "stopped"
	}
	return "not_installed"
}
