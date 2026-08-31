package pluginruntime

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	defaultBunVersion       = "1.4.0"
	maxBunArchiveBytes      = int64(256 << 20)
	maxPluginExtractedBytes = int64(64 << 20)
	maxPluginSourceFiles    = 2_000
	pluginInstallTimeout    = 30 * time.Minute
)

func (m *Manager) Install(key, version string) error {
	if key != RemotionPluginKey {
		return ErrUnsupported
	}
	if strings.TrimSpace(version) == "" {
		return errors.New("插件版本不能为空")
	}
	m.mu.Lock()
	if m.installing {
		m.mu.Unlock()
		return errors.New("Remotion 插件正在安装")
	}
	if m.command != nil {
		m.mu.Unlock()
		return errors.New("请先停用 Remotion 插件再安装")
	}
	m.installing = true
	m.status.State = "installing"
	m.status.InstallStage = "preparing_source"
	m.status.LastError = ""
	m.status.DownloadedBytes = 0
	m.status.TotalBytes = 0
	m.mu.Unlock()

	target, err := m.installRemotionDependencies()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.installing = false
	if err != nil {
		m.status.State = "error"
		m.status.LastError = err.Error()
		return err
	}
	m.pluginDir = target
	m.bunPath = resolveBunPath(target)
	m.status = m.inspectInstallation()
	if !m.status.Installed {
		err := errors.New("依赖安装完成，但 Remotion 运行环境校验失败")
		m.status.State = "error"
		m.status.LastError = err.Error()
		return err
	}
	return nil
}

func (m *Manager) Uninstall(key string) error {
	if key != RemotionPluginKey {
		return ErrUnsupported
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.installing {
		return errors.New("Remotion 插件正在安装")
	}
	if m.command != nil {
		return errors.New("请先停用 Remotion 插件再卸载")
	}
	target := filepath.Join(m.dataDir, "plugins", "remotion-video")
	if filepath.Clean(m.pluginDir) != filepath.Clean(target) {
		return errors.New("当前插件来自开发目录或随程序分发，不能在线卸载")
	}
	if err := os.RemoveAll(target); err != nil {
		return fmt.Errorf("删除 Remotion 插件失败：%w", err)
	}
	m.pluginDir = target
	m.bunPath = resolveBunPath(target)
	m.status = Status{State: "not_installed", PluginDir: target}
	return nil
}

func (m *Manager) installRemotionDependencies() (string, error) {
	pluginsRoot := filepath.Join(m.dataDir, "plugins")
	if err := os.MkdirAll(pluginsRoot, 0o700); err != nil {
		return "", fmt.Errorf("创建插件目录失败：%w", err)
	}
	cleanupPluginInstallTemps(pluginsRoot)
	staging, err := os.MkdirTemp(pluginsRoot, ".remotion-install-*")
	if err != nil {
		return "", fmt.Errorf("创建插件安装目录失败：%w", err)
	}
	defer os.RemoveAll(staging)
	candidate := filepath.Join(staging, "remotion-video")
	if err := m.preparePluginSource(staging, candidate); err != nil {
		return "", err
	}

	m.setInstallStage("preparing_bun")
	bunPath, err := m.prepareBun(candidate)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), pluginInstallTimeout)
	defer cancel()
	m.setInstallStage("installing_dependencies")
	if err := runPluginInstallCommand(ctx, candidate, bunPath, "install", "--production", "--frozen-lockfile"); err != nil {
		return "", fmt.Errorf("安装 Remotion npm 依赖失败：%w", err)
	}
	m.setInstallStage("installing_browser")
	if err := runPluginInstallCommand(ctx, candidate, bunPath, "run", "browser:ensure"); err != nil {
		return "", fmt.Errorf("安装 Remotion Chromium 失败：%w", err)
	}
	if err := validateRemotionPackage(candidate); err != nil {
		return "", err
	}
	m.setInstallStage("finalizing")
	target := filepath.Join(pluginsRoot, "remotion-video")
	if err := preserveLegacyRenders(filepath.Join(target, "renders"), m.rendersDir()); err != nil {
		return "", err
	}
	if err := replacePluginDirectory(candidate, target, pluginsRoot); err != nil {
		return "", err
	}
	return target, nil
}

func (m *Manager) setInstallStage(stage string) {
	m.mu.Lock()
	m.status.InstallStage = stage
	m.mu.Unlock()
}

func (m *Manager) preparePluginSource(staging, candidate string) error {
	if len(embeddedRemotionPluginSource) > 0 {
		archivePath := filepath.Join(staging, "source.tar.gz")
		if err := os.WriteFile(archivePath, embeddedRemotionPluginSource, 0o600); err != nil {
			return fmt.Errorf("写入内置插件源码失败：%w", err)
		}
		if err := extractPluginSourceArchive(archivePath, staging); err != nil {
			return err
		}
		_ = os.Remove(archivePath)
		return validatePluginSource(candidate)
	}
	source := strings.TrimSpace(os.Getenv("REMOTION_PLUGIN_SOURCE_DIR"))
	if source == "" && fileExists(filepath.Join(m.pluginDir, "package.json")) {
		source = m.pluginDir
	}
	if source == "" {
		return errors.New("当前开发构建未嵌入 Remotion 插件源码，请设置 REMOTION_PLUGIN_SOURCE_DIR")
	}
	if err := copyPluginSource(source, candidate); err != nil {
		return err
	}
	return validatePluginSource(candidate)
}

func (m *Manager) prepareBun(candidate string) (string, error) {
	target := filepath.Join(candidate, "bin", executableName("bun"))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", err
	}
	if source := resolveAvailableBun(m.pluginDir); source != "" {
		if err := copyExecutable(source, target); err != nil {
			return "", err
		}
		return target, nil
	}
	return target, downloadBun(target, m)
}

func resolveAvailableBun(pluginDir string) string {
	if configured := strings.TrimSpace(os.Getenv("REMOTION_BUN_PATH")); configured != "" && fileExists(configured) {
		return configured
	}
	if pluginDir != "" {
		bundled := filepath.Join(pluginDir, "bin", executableName("bun"))
		if fileExists(bundled) {
			return bundled
		}
	}
	path, _ := exec.LookPath(executableName("bun"))
	return path
}

func downloadBun(target string, manager *Manager) error {
	version := strings.TrimPrefix(strings.TrimSpace(os.Getenv("REMOTION_BUN_VERSION")), "v")
	if version == "" {
		version = defaultBunVersion
	}
	asset, err := bunAssetName()
	if err != nil {
		return err
	}
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("REMOTION_BUN_RELEASE_BASE_URL")), "/")
	if base == "" {
		base = "https://github.com/oven-sh/bun/releases/download/bun-v" + version
	}
	archiveURL := base + "/" + asset
	checksumURL := base + "/SHASUMS256.txt"
	if override := strings.TrimSpace(os.Getenv("REMOTION_BUN_DOWNLOAD_URL")); override != "" {
		archiveURL = strings.NewReplacer("{version}", version, "{asset}", asset).Replace(override)
	}
	if override := strings.TrimSpace(os.Getenv("REMOTION_BUN_CHECKSUM_URL")); override != "" {
		checksumURL = strings.NewReplacer("{version}", version, "{asset}", asset).Replace(override)
	}
	if err := validHTTPURL(archiveURL); err != nil {
		return err
	}
	expected, err := downloadBunChecksum(checksumURL, asset)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".bun-*.zip")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := downloadFile(archiveURL, temporary, maxBunArchiveBytes, manager); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	actual, err := fileSHA256(temporaryPath)
	if err != nil {
		return err
	}
	if !strings.EqualFold(actual, expected) {
		return fmt.Errorf("Bun SHA-256 校验失败：期望 %s，实际 %s", expected, actual)
	}
	return extractBunExecutable(temporaryPath, target)
}

func bunAssetName() (string, error) {
	architecture := map[string]string{"amd64": "x64", "arm64": "aarch64"}[runtime.GOARCH]
	if architecture == "" {
		return "", fmt.Errorf("暂不支持在 %s/%s 安装 Bun", runtime.GOOS, runtime.GOARCH)
	}
	operatingSystem := map[string]string{"linux": "linux", "darwin": "darwin", "windows": "windows"}[runtime.GOOS]
	if operatingSystem == "" {
		return "", fmt.Errorf("暂不支持在 %s 安装 Bun", runtime.GOOS)
	}
	return fmt.Sprintf("bun-%s-%s.zip", operatingSystem, architecture), nil
}

func downloadBunChecksum(address, asset string) (string, error) {
	content, err := downloadSmallFile(address)
	if err != nil {
		return "", fmt.Errorf("下载 Bun 校验文件失败：%w", err)
	}
	for _, line := range strings.Split(string(content), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && strings.TrimPrefix(fields[len(fields)-1], "*") == asset && len(fields[0]) == sha256.Size*2 {
			if _, err := hex.DecodeString(fields[0]); err == nil {
				return strings.ToLower(fields[0]), nil
			}
		}
	}
	return "", fmt.Errorf("Bun 校验文件中没有 %s", asset)
}

func downloadSmallFile(address string) ([]byte, error) {
	if err := validHTTPURL(address); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	request.Header.Set("User-Agent", "sweet-potato-plugin-installer")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", response.StatusCode)
	}
	return io.ReadAll(io.LimitReader(response.Body, 1<<20))
}

func downloadFile(address string, destination *os.File, limit int64, manager *Manager) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	request.Header.Set("User-Agent", "sweet-potato-plugin-installer")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fmt.Errorf("下载 Bun 失败：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("下载 Bun 返回 HTTP %d", response.StatusCode)
	}
	if response.ContentLength > limit {
		return errors.New("Bun 安装包超过大小限制")
	}
	manager.mu.Lock()
	manager.status.TotalBytes = response.ContentLength
	manager.status.DownloadedBytes = 0
	manager.mu.Unlock()
	limited := &io.LimitedReader{R: response.Body, N: limit + 1}
	written, err := io.Copy(destination, &pluginProgressReader{manager: manager, reader: limited})
	if err != nil {
		return err
	}
	if written > limit {
		return errors.New("Bun 安装包超过大小限制")
	}
	return nil
}

func extractBunExecutable(archivePath, target string) error {
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("Bun 安装包不是有效 ZIP：%w", err)
	}
	defer archive.Close()
	wanted := executableName("bun")
	for _, file := range archive.File {
		if filepath.Base(filepath.FromSlash(file.Name)) != wanted || file.FileInfo().IsDir() {
			continue
		}
		input, err := file.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, io.LimitReader(input, maxBunArchiveBytes))
		closeInputErr := input.Close()
		closeOutputErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeInputErr != nil {
			return closeInputErr
		}
		return closeOutputErr
	}
	return errors.New("Bun 安装包中没有找到可执行文件")
}

func runPluginInstallCommand(ctx context.Context, directory, bunPath string, args ...string) error {
	command := exec.CommandContext(ctx, bunPath, args...)
	command.Dir = directory
	command.Env = append(os.Environ(), "CI=1")
	if registry := strings.TrimSpace(os.Getenv("REMOTION_NPM_REGISTRY")); registry != "" {
		command.Env = append(command.Env,
			"BUN_CONFIG_REGISTRY="+registry,
			"npm_config_registry="+registry,
		)
	}
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return errors.New("安装命令执行超时")
		}
		return err
	}
	return nil
}

func replacePluginDirectory(candidate, target, pluginsRoot string) error {
	backup := filepath.Join(pluginsRoot, fmt.Sprintf(".remotion-backup-%d", time.Now().UnixNano()))
	hadTarget := false
	if _, err := os.Stat(target); err == nil {
		if err := os.Rename(target, backup); err != nil {
			return fmt.Errorf("备份旧插件失败：%w", err)
		}
		hadTarget = true
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(candidate, target); err != nil {
		if hadTarget {
			_ = os.Rename(backup, target)
		}
		return fmt.Errorf("提交插件安装失败：%w", err)
	}
	if hadTarget {
		_ = os.RemoveAll(backup)
	}
	return nil
}

func preserveLegacyRenders(source, target string) error {
	info, err := os.Stat(source)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("读取旧版 Remotion 渲染目录失败：%w", err)
	}
	if !info.IsDir() {
		return errors.New("旧版 Remotion 渲染路径不是目录")
	}
	if err := os.MkdirAll(target, 0o700); err != nil {
		return fmt.Errorf("创建 Remotion 持久化渲染目录失败：%w", err)
	}
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil || relative == "." {
			return err
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o700)
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		if _, err := os.Stat(destination); err == nil {
			return nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return copyRegularFile(path, destination, 0o600)
	})
}

func copyPluginSource(source, target string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil || relative == "." {
			return err
		}
		if entry.IsDir() && (entry.Name() == "node_modules" || entry.Name() == "renders" || entry.Name() == ".git") {
			return filepath.SkipDir
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			return err
		}
		return copyRegularFile(path, destination, 0o600)
	})
}

func copyRegularFile(source, target string, mode os.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		_ = input.Close()
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeInputErr := input.Close()
	closeOutputErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeInputErr != nil {
		return closeInputErr
	}
	return closeOutputErr
}

func copyExecutable(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func extractPluginSourceArchive(archivePath, destination string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	compressed, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("内置插件源码包无效：%w", err)
	}
	defer compressed.Close()
	reader := tar.NewReader(compressed)
	var extracted int64
	files := 0
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		files++
		if files > maxPluginSourceFiles {
			return errors.New("内置插件源码文件数量超过限制")
		}
		name := filepath.Clean(filepath.FromSlash(header.Name))
		if name == "." || filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, ".."+string(filepath.Separator)) {
			return fmt.Errorf("插件源码包含不安全路径：%s", header.Name)
		}
		target := filepath.Join(destination, name)
		if !strings.HasPrefix(target, filepath.Clean(destination)+string(filepath.Separator)) {
			return fmt.Errorf("插件源码路径越界：%s", header.Name)
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			extracted += header.Size
			if header.Size < 0 || extracted > maxPluginExtractedBytes {
				return errors.New("内置插件源码大小超过限制")
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
			if err != nil {
				return err
			}
			_, copyErr := io.CopyN(output, reader, header.Size)
			closeErr := output.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		default:
			return fmt.Errorf("插件源码包含不支持的文件类型：%s", header.Name)
		}
	}
	return nil
}

func validatePluginSource(directory string) error {
	for _, relative := range []string{"package.json", "bun.lock"} {
		info, err := os.Stat(filepath.Join(directory, relative))
		if err != nil {
			return fmt.Errorf("插件源码缺少 %s", relative)
		}
		if info.IsDir() {
			return fmt.Errorf("插件源码中的 %s 类型不正确", relative)
		}
	}
	for _, relative := range []string{"server", "src"} {
		info, err := os.Stat(filepath.Join(directory, relative))
		if err != nil {
			return fmt.Errorf("插件源码缺少 %s", relative)
		}
		if !info.IsDir() {
			return fmt.Errorf("插件源码中的 %s 类型不正确", relative)
		}
	}
	return nil
}

func validateRemotionPackage(directory string) error {
	required := []string{"package.json", filepath.Join("bin", executableName("bun")), filepath.Join("node_modules", ".remotion", "chrome-headless-shell")}
	for _, relative := range required {
		info, err := os.Stat(filepath.Join(directory, relative))
		if err != nil {
			return fmt.Errorf("安装结果缺少 %s", relative)
		}
		if relative != filepath.Join("node_modules", ".remotion", "chrome-headless-shell") && info.IsDir() {
			return fmt.Errorf("安装结果中的 %s 类型不正确", relative)
		}
	}
	return nil
}

func cleanupPluginInstallTemps(pluginsRoot string) {
	for _, pattern := range []string{".remotion-install-*", ".remotion-backup-*"} {
		matches, _ := filepath.Glob(filepath.Join(pluginsRoot, pattern))
		for _, match := range matches {
			_ = os.RemoveAll(match)
		}
	}
}

type pluginProgressReader struct {
	manager *Manager
	reader  io.Reader
	total   int64
}

func (r *pluginProgressReader) Read(buffer []byte) (int, error) {
	read, err := r.reader.Read(buffer)
	if read > 0 {
		r.total += int64(read)
		r.manager.mu.Lock()
		r.manager.status.DownloadedBytes = r.total
		r.manager.mu.Unlock()
	}
	return read, err
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func validHTTPURL(address string) error {
	parsed, err := url.Parse(address)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return errors.New("下载地址无效")
	}
	return nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func executableName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}
