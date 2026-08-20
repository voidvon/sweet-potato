//go:build windows

package selfupdate

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows"
)

const updateHelperFlag = "--sweet-potato-apply-update"

func ActivateAndRestart(update StagedUpdate) error {
	arguments, err := json.Marshal(os.Args[1:])
	if err != nil {
		return err
	}
	command := exec.Command(update.StagedPath, updateHelperFlag, update.TargetPath, strconv.Itoa(os.Getpid()), base64.RawURLEncoding.EncodeToString(arguments))
	command.Env = os.Environ()
	command.Dir, _ = os.Getwd()
	if err := command.Start(); err != nil {
		return fmt.Errorf("启动更新助手失败: %w", err)
	}
	return nil
}

func RunUpdateHelper(args []string) (bool, error) {
	if len(args) == 0 || args[0] != updateHelperFlag {
		return false, nil
	}
	if len(args) != 4 {
		return true, errors.New("更新助手参数无效")
	}
	targetPath := args[1]
	pid, err := strconv.Atoi(args[2])
	if err != nil || pid <= 0 {
		return true, errors.New("更新助手进程号无效")
	}
	encodedArgs, err := base64.RawURLEncoding.DecodeString(args[3])
	if err != nil {
		return true, errors.New("更新助手启动参数无效")
	}
	var originalArgs []string
	if err := json.Unmarshal(encodedArgs, &originalArgs); err != nil {
		return true, errors.New("更新助手启动参数无效")
	}
	if err := waitForProcess(pid); err != nil {
		return true, err
	}
	stagedPath, err := os.Executable()
	if err != nil {
		return true, err
	}
	binary, err := os.ReadFile(stagedPath)
	if err != nil {
		return true, fmt.Errorf("读取新版程序失败: %w", err)
	}
	backupPath := targetPath + ".previous"
	_ = os.Remove(backupPath)
	if err := os.Rename(targetPath, backupPath); err != nil {
		return true, fmt.Errorf("备份当前版本失败: %w", err)
	}
	if err := os.WriteFile(targetPath, binary, 0o755); err != nil {
		_ = os.Rename(backupPath, targetPath)
		return true, fmt.Errorf("安装新版本失败: %w", err)
	}
	command := exec.Command(targetPath, originalArgs...)
	command.Env = append(os.Environ(), "SWEET_POTATO_UPDATE_CLEANUP="+stagedPath)
	command.Dir, _ = os.Getwd()
	if err := command.Start(); err != nil {
		_ = os.Remove(targetPath)
		_ = os.Rename(backupPath, targetPath)
		return true, fmt.Errorf("启动新版本失败: %w", err)
	}
	return true, nil
}

func waitForProcess(pid int) error {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
			return nil
		}
		return fmt.Errorf("等待旧版本退出失败: %w", err)
	}
	defer windows.CloseHandle(handle)
	result, err := windows.WaitForSingleObject(handle, 30_000)
	if err != nil {
		return fmt.Errorf("等待旧版本退出失败: %w", err)
	}
	if result == uint32(windows.WAIT_TIMEOUT) {
		return errors.New("等待旧版本退出超时")
	}
	return nil
}

func CleanupUpdateHelper() {
	path := strings.TrimSpace(os.Getenv("SWEET_POTATO_UPDATE_CLEANUP"))
	if path == "" {
		return
	}
	go func() {
		for attempt := 0; attempt < 20; attempt++ {
			time.Sleep(500 * time.Millisecond)
			if err := os.Remove(path); err == nil || os.IsNotExist(err) {
				return
			}
		}
	}()
}
