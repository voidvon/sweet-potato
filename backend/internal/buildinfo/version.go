package buildinfo

import "strings"

// Version is injected from the repository VERSION file by the Makefile.
var Version = "dev"

func Current() string {
	version := strings.TrimSpace(Version)
	if version == "" {
		return "dev"
	}
	return strings.TrimPrefix(version, "v")
}
