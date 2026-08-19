package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ai-marketing-go/internal/config"
	"ai-marketing-go/internal/httpapi"
)

func main() {
	cfg := config.Load()
	apiServer, err := httpapi.New(cfg)
	if err != nil {
		slog.Error("initialize Go server failed", "error", err)
		os.Exit(1)
	}
	defer apiServer.Close()

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           apiServer.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      10 * time.Minute,
		IdleTimeout:       2 * time.Minute,
	}

	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("Go server listening", "addr", cfg.Addr, "dataDir", cfg.DataDir)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrors <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-serverErrors:
		slog.Error("Go server stopped unexpectedly", "error", err)
		return
	case <-stop:
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		slog.Error("Go server shutdown failed", "error", err)
		os.Exit(1)
	}
}
