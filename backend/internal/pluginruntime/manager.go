package pluginruntime

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
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
	ErrNotInstalled = errors.New("Remotion 插件运行包未安装")
	ErrUnsupported  = errors.New("不支持的插件")
)

type Status struct {
	Installed  bool   `json:"installed"`
	State      string `json:"state"`
	Endpoint   string `json:"endpoint,omitempty"`
	PID        int    `json:"pid,omitempty"`
	StartedAt  string `json:"startedAt,omitempty"`
	LastError  string `json:"lastError,omitempty"`
	PluginDir  string `json:"pluginDir,omitempty"`
	BunVersion string `json:"bunVersion,omitempty"`
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
}

func New(dataDir string) *Manager {
	pluginDir := resolvePluginDir()
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
	rendersDir := filepath.Join(m.dataDir, "plugins", "remotion-video", "renders")
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
	status := Status{State: "not_installed", PluginDir: m.pluginDir}
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

func resolvePluginDir() string {
	if configured := strings.TrimSpace(os.Getenv("REMOTION_PLUGIN_DIR")); configured != "" {
		if absolute, err := filepath.Abs(configured); err == nil {
			return absolute
		}
		return filepath.Clean(configured)
	}
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Join(filepath.Dir(executable), "plugins", "remotion-video")
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
