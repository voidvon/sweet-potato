//go:build windows

package pluginruntime

import "os/exec"

func configureProcessGroup(_ *exec.Cmd) {}

func stopProcessGroup(command *exec.Cmd) {
	if command.Process != nil {
		_ = command.Process.Kill()
	}
}

func killProcessGroup(command *exec.Cmd) {
	if command.Process != nil {
		_ = command.Process.Kill()
	}
}
