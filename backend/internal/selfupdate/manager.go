package selfupdate

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"sweet-potato-go/internal/buildinfo"
)

const (
	DefaultRepository = "voidvon/sweet-potato"
	GitHubURL         = "https://github.com/voidvon/sweet-potato"
	maxDownloadSize   = 256 << 20
)

type Info struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion,omitempty"`
	UpdateAvailable bool   `json:"updateAvailable"`
	Supported       bool   `json:"supported"`
	GitHubURL       string `json:"githubUrl"`
	ReleaseURL      string `json:"releaseUrl,omitempty"`
	PublishedAt     string `json:"publishedAt,omitempty"`
	ReleaseNotes    string `json:"releaseNotes,omitempty"`
	AssetName       string `json:"assetName,omitempty"`
	CheckError      string `json:"checkError,omitempty"`
}

type StagedUpdate struct {
	Version    string
	StagedPath string
	TargetPath string
}

type Manager struct {
	CurrentVersion string
	Repository     string
	APIBaseURL     string
	WebBaseURL     string
	Client         *http.Client
	GOOS           string
	GOARCH         string
	Executable     func() (string, error)
}

type releaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Digest             string `json:"digest"`
}

type release struct {
	TagName     string         `json:"tag_name"`
	HTMLURL     string         `json:"html_url"`
	PublishedAt string         `json:"published_at"`
	Body        string         `json:"body"`
	Draft       bool           `json:"draft"`
	Prerelease  bool           `json:"prerelease"`
	Assets      []releaseAsset `json:"assets"`
}

func NewManager() *Manager {
	return &Manager{
		CurrentVersion: buildinfo.Current(),
		Repository:     DefaultRepository,
		APIBaseURL:     "https://api.github.com",
		WebBaseURL:     "https://github.com",
		Client:         &http.Client{Timeout: 2 * time.Minute},
		GOOS:           runtime.GOOS,
		GOARCH:         runtime.GOARCH,
		Executable:     os.Executable,
	}
}

func (m *Manager) Check(ctx context.Context) (Info, error) {
	info := m.baseInfo()
	release, err := m.latestRelease(ctx)
	if err != nil {
		return info, err
	}
	latest, ok := parseVersion(release.TagName)
	if !ok {
		return info, fmt.Errorf("GitHub 最新版本号无效: %s", release.TagName)
	}
	info.LatestVersion = latest.String()
	info.ReleaseURL = release.HTMLURL
	info.PublishedAt = release.PublishedAt
	info.ReleaseNotes = release.Body
	assetName, supported := assetNameFor(m.goos(), m.goarch(), latest.String())
	info.AssetName = assetName
	info.Supported = supported && findAsset(release.Assets, assetName) != nil && findAsset(release.Assets, "SHA256SUMS.txt") != nil
	current, currentOK := parseVersion(m.CurrentVersion)
	if !currentOK {
		return info, errors.New("当前程序未包含有效的构建版本，无法执行自动更新")
	}
	info.UpdateAvailable = latest.Compare(current) > 0
	if info.UpdateAvailable && !info.Supported {
		return info, fmt.Errorf("最新版本未提供当前平台 %s/%s 的更新包", m.goos(), m.goarch())
	}
	return info, nil
}

func (m *Manager) Stage(ctx context.Context) (StagedUpdate, error) {
	info, err := m.Check(ctx)
	if err != nil {
		return StagedUpdate{}, err
	}
	if !info.UpdateAvailable {
		return StagedUpdate{}, errors.New("当前已是最新版本")
	}
	release, err := m.latestRelease(ctx)
	if err != nil {
		return StagedUpdate{}, err
	}
	asset := findAsset(release.Assets, info.AssetName)
	checksums := findAsset(release.Assets, "SHA256SUMS.txt")
	if asset == nil || checksums == nil {
		return StagedUpdate{}, errors.New("GitHub Release 缺少更新包或校验文件")
	}
	checksumData, err := m.download(ctx, checksums.BrowserDownloadURL)
	if err != nil {
		return StagedUpdate{}, fmt.Errorf("下载校验文件失败: %w", err)
	}
	wantDigest, err := checksumFor(checksumData, info.AssetName)
	if err != nil {
		return StagedUpdate{}, err
	}
	archiveData, err := m.download(ctx, asset.BrowserDownloadURL)
	if err != nil {
		return StagedUpdate{}, fmt.Errorf("下载更新包失败: %w", err)
	}
	digest := sha256.Sum256(archiveData)
	gotDigest := hex.EncodeToString(digest[:])
	if !strings.EqualFold(gotDigest, wantDigest) {
		return StagedUpdate{}, errors.New("更新包 SHA-256 校验失败")
	}
	if githubDigest := strings.TrimPrefix(strings.TrimSpace(asset.Digest), "sha256:"); githubDigest != "" && !strings.EqualFold(gotDigest, githubDigest) {
		return StagedUpdate{}, errors.New("更新包与 GitHub 资产摘要不一致")
	}
	binaryData, err := extractBinary(info.AssetName, archiveData, m.goos())
	if err != nil {
		return StagedUpdate{}, err
	}
	targetPath, err := m.executable()()
	if err != nil {
		return StagedUpdate{}, fmt.Errorf("读取当前程序路径失败: %w", err)
	}
	targetPath, err = filepath.Abs(targetPath)
	if err != nil {
		return StagedUpdate{}, fmt.Errorf("解析当前程序路径失败: %w", err)
	}
	if filepath.Base(targetPath) != binaryName(m.goos()) {
		return StagedUpdate{}, fmt.Errorf("当前程序文件名必须是 %s，无法执行自动更新", binaryName(m.goos()))
	}
	stagedFile, err := os.CreateTemp(filepath.Dir(targetPath), ".sweet-potato-update-*")
	if err != nil {
		return StagedUpdate{}, fmt.Errorf("当前程序目录不可写: %w", err)
	}
	stagedPath := stagedFile.Name()
	removeStaged := true
	defer func() {
		_ = stagedFile.Close()
		if removeStaged {
			_ = os.Remove(stagedPath)
		}
	}()
	if err := stagedFile.Chmod(0o755); err != nil {
		return StagedUpdate{}, fmt.Errorf("设置更新程序权限失败: %w", err)
	}
	if _, err := stagedFile.Write(binaryData); err != nil {
		return StagedUpdate{}, fmt.Errorf("写入更新程序失败: %w", err)
	}
	if err := stagedFile.Sync(); err != nil {
		return StagedUpdate{}, fmt.Errorf("同步更新程序失败: %w", err)
	}
	if err := stagedFile.Close(); err != nil {
		return StagedUpdate{}, fmt.Errorf("关闭更新程序失败: %w", err)
	}
	removeStaged = false
	return StagedUpdate{Version: info.LatestVersion, StagedPath: stagedPath, TargetPath: targetPath}, nil
}

func (m *Manager) baseInfo() Info {
	return Info{CurrentVersion: strings.TrimPrefix(strings.TrimSpace(m.CurrentVersion), "v"), GitHubURL: GitHubURL}
}

func (m *Manager) latestRelease(ctx context.Context) (release, error) {
	requestURL := strings.TrimRight(m.apiBaseURL(), "/") + "/repos/" + m.repository() + "/releases/latest"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return release{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "sweet-potato-self-update/"+m.CurrentVersion)
	if token := strings.TrimSpace(os.Getenv("GITHUB_TOKEN")); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := m.client().Do(req)
	if err != nil {
		return m.latestReleaseFromRedirect(ctx, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return m.latestReleaseFromRedirect(ctx, fmt.Errorf("GitHub API HTTP %d", resp.StatusCode))
	}
	var result release
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&result); err != nil {
		return release{}, fmt.Errorf("解析 GitHub 版本失败: %w", err)
	}
	if result.Draft || result.Prerelease {
		return release{}, errors.New("GitHub 最新版本不是正式版本")
	}
	return result, nil
}

func (m *Manager) latestReleaseFromRedirect(ctx context.Context, apiErr error) (release, error) {
	requestURL := strings.TrimRight(m.webBaseURL(), "/") + "/" + m.repository() + "/releases/latest"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return release{}, err
	}
	req.Header.Set("User-Agent", "sweet-potato-self-update/"+m.CurrentVersion)
	resp, err := m.client().Do(req)
	if err != nil {
		return release{}, fmt.Errorf("检查 GitHub 版本失败: %v; 回退检查失败: %w", apiErr, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return release{}, fmt.Errorf("检查 GitHub 版本失败: %v; 回退检查 HTTP %d", apiErr, resp.StatusCode)
	}
	marker := "/releases/tag/"
	pathValue := resp.Request.URL.Path
	markerIndex := strings.LastIndex(pathValue, marker)
	if markerIndex < 0 {
		return release{}, errors.New("GitHub 最新版本重定向地址无效")
	}
	tagName := strings.Trim(pathValue[markerIndex+len(marker):], "/")
	latest, ok := parseVersion(tagName)
	if !ok {
		return release{}, fmt.Errorf("GitHub 最新版本号无效: %s", tagName)
	}
	assetName, supported := assetNameFor(m.goos(), m.goarch(), latest.String())
	if !supported {
		assetName = ""
	}
	releaseBaseURL := strings.TrimRight(m.webBaseURL(), "/") + "/" + m.repository() + "/releases/download/v" + latest.String() + "/"
	assets := []releaseAsset{{Name: "SHA256SUMS.txt", BrowserDownloadURL: releaseBaseURL + "SHA256SUMS.txt"}}
	if assetName != "" {
		assets = append(assets, releaseAsset{Name: assetName, BrowserDownloadURL: releaseBaseURL + assetName})
	}
	return release{
		TagName: tagName,
		HTMLURL: resp.Request.URL.String(),
		Assets:  assets,
	}, nil
}

func (m *Manager) download(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "sweet-potato-self-update/"+m.CurrentVersion)
	resp, err := m.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > maxDownloadSize {
		return nil, errors.New("下载文件超过大小限制")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxDownloadSize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxDownloadSize {
		return nil, errors.New("下载文件超过大小限制")
	}
	return data, nil
}

func (m *Manager) client() *http.Client {
	if m.Client != nil {
		return m.Client
	}
	return &http.Client{Timeout: 2 * time.Minute}
}

func (m *Manager) apiBaseURL() string {
	if value := strings.TrimSpace(m.APIBaseURL); value != "" {
		return value
	}
	return "https://api.github.com"
}

func (m *Manager) webBaseURL() string {
	if value := strings.TrimSpace(m.WebBaseURL); value != "" {
		return value
	}
	return "https://github.com"
}

func (m *Manager) repository() string {
	if value := strings.Trim(strings.TrimSpace(m.Repository), "/"); value != "" {
		return value
	}
	return DefaultRepository
}

func (m *Manager) goos() string {
	if m.GOOS != "" {
		return m.GOOS
	}
	return runtime.GOOS
}

func (m *Manager) goarch() string {
	if m.GOARCH != "" {
		return m.GOARCH
	}
	return runtime.GOARCH
}

func (m *Manager) executable() func() (string, error) {
	if m.Executable != nil {
		return m.Executable
	}
	return os.Executable
}

func findAsset(assets []releaseAsset, name string) *releaseAsset {
	for index := range assets {
		if assets[index].Name == name {
			return &assets[index]
		}
	}
	return nil
}

func assetNameFor(goos, goarch, version string) (string, bool) {
	if (goos != "linux" && goos != "darwin" && goos != "windows") || (goarch != "amd64" && goarch != "arm64") {
		return "", false
	}
	if goos == "windows" && goarch != "amd64" {
		return "", false
	}
	extension := "tar.gz"
	if goos == "windows" {
		extension = "zip"
	}
	return fmt.Sprintf("sweet-potato-v%s-%s-%s.%s", version, goos, goarch, extension), true
}

func checksumFor(data []byte, assetName string) (string, error) {
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || strings.TrimPrefix(fields[1], "*") != assetName {
			continue
		}
		if len(fields[0]) != sha256.Size*2 {
			break
		}
		if _, err := hex.DecodeString(fields[0]); err == nil {
			return strings.ToLower(fields[0]), nil
		}
	}
	return "", fmt.Errorf("SHA256SUMS.txt 中缺少 %s", assetName)
}

func extractBinary(assetName string, archiveData []byte, goos string) ([]byte, error) {
	if strings.HasSuffix(assetName, ".zip") {
		return extractZipBinary(archiveData, goos)
	}
	return extractTarBinary(archiveData, goos)
}

func binaryName(goos string) string {
	if goos == "windows" {
		return "sweet-potato.exe"
	}
	return "sweet-potato"
}

func extractTarBinary(data []byte, goos string) ([]byte, error) {
	gzipReader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("打开更新压缩包失败: %w", err)
	}
	defer gzipReader.Close()
	reader := tar.NewReader(gzipReader)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("读取更新压缩包失败: %w", err)
		}
		cleanName := path.Clean(strings.ReplaceAll(header.Name, "\\", "/"))
		if cleanName == "." || strings.HasPrefix(cleanName, "../") || path.IsAbs(cleanName) {
			return nil, errors.New("更新压缩包包含不安全路径")
		}
		if path.Base(cleanName) != binaryName(goos) {
			continue
		}
		if header.Typeflag != tar.TypeReg || header.Size <= 0 || header.Size > maxDownloadSize {
			return nil, errors.New("更新压缩包中的程序文件无效")
		}
		result, err := io.ReadAll(io.LimitReader(reader, header.Size))
		if err != nil {
			return nil, err
		}
		if int64(len(result)) != header.Size {
			return nil, errors.New("更新压缩包中的程序文件不完整")
		}
		return result, nil
	}
	return nil, errors.New("更新压缩包中未找到程序文件")
}

func extractZipBinary(data []byte, goos string) ([]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("打开更新压缩包失败: %w", err)
	}
	for _, file := range reader.File {
		cleanName := path.Clean(strings.ReplaceAll(file.Name, "\\", "/"))
		if cleanName == "." || strings.HasPrefix(cleanName, "../") || path.IsAbs(cleanName) {
			return nil, errors.New("更新压缩包包含不安全路径")
		}
		if path.Base(cleanName) != binaryName(goos) {
			continue
		}
		if file.FileInfo().IsDir() || file.UncompressedSize64 == 0 || file.UncompressedSize64 > maxDownloadSize {
			return nil, errors.New("更新压缩包中的程序文件无效")
		}
		stream, err := file.Open()
		if err != nil {
			return nil, err
		}
		result, readErr := io.ReadAll(io.LimitReader(stream, int64(file.UncompressedSize64)))
		closeErr := stream.Close()
		if readErr != nil {
			return nil, readErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if uint64(len(result)) != file.UncompressedSize64 {
			return nil, errors.New("更新压缩包中的程序文件不完整")
		}
		return result, nil
	}
	return nil, errors.New("更新压缩包中未找到程序文件")
}

type version [3]int

func parseVersion(value string) (version, bool) {
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(value), "v"), ".")
	if len(parts) != 3 {
		return version{}, false
	}
	var result version
	for index, part := range parts {
		number, err := strconv.Atoi(part)
		if err != nil || number < 0 {
			return version{}, false
		}
		result[index] = number
	}
	return result, true
}

func (v version) Compare(other version) int {
	for index := range v {
		if v[index] < other[index] {
			return -1
		}
		if v[index] > other[index] {
			return 1
		}
	}
	return 0
}

func (v version) String() string {
	return fmt.Sprintf("%d.%d.%d", v[0], v[1], v[2])
}
