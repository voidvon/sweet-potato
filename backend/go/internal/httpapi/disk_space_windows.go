//go:build windows

package httpapi

func availableDiskBytes(string) uint64 { return 0 }
