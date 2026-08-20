//go:build !windows

package selfupdate

import (
	"fmt"
	"os"
	"syscall"
)

func ActivateAndRestart(update StagedUpdate) error {
	backupPath := update.TargetPath + ".previous"
	if err := os.Remove(backupPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("清理旧版本备份失败: %w", err)
	}
	if err := os.Rename(update.TargetPath, backupPath); err != nil {
		return fmt.Errorf("备份当前版本失败: %w", err)
	}
	if err := os.Rename(update.StagedPath, update.TargetPath); err != nil {
		_ = os.Rename(backupPath, update.TargetPath)
		return fmt.Errorf("安装新版本失败: %w", err)
	}
	if err := syscall.Exec(update.TargetPath, os.Args, os.Environ()); err != nil {
		_ = os.Remove(update.TargetPath)
		_ = os.Rename(backupPath, update.TargetPath)
		return fmt.Errorf("启动新版本失败: %w", err)
	}
	return nil
}

func RunUpdateHelper(_ []string) (bool, error) {
	return false, nil
}

func CleanupUpdateHelper() {}
