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

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/httpapi"
	"sweet-potato-go/internal/selfupdate"
)

func main() {
	if handled, err := selfupdate.RunUpdateHelper(os.Args[1:]); handled {
		if err != nil {
			slog.Error("apply server update failed", "error", err)
			os.Exit(1)
		}
		return
	}
	selfupdate.CleanupUpdateHelper()

	cfg := config.Load()
	apiServer, err := httpapi.New(cfg)
	if err != nil {
		slog.Error("initialize Go server failed", "error", err)
		os.Exit(1)
	}
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
	var pendingUpdate *selfupdate.StagedUpdate
	select {
	case err := <-serverErrors:
		slog.Error("Go server stopped unexpectedly", "error", err)
	case <-stop:
	case update := <-apiServer.UpdateRequested():
		pendingUpdate = &update
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		slog.Error("Go server shutdown failed", "error", err)
		os.Exit(1)
	}
	if err := apiServer.Close(); err != nil {
		slog.Error("close Go server failed", "error", err)
		os.Exit(1)
	}
	if pendingUpdate != nil {
		slog.Info("activating server update", "version", pendingUpdate.Version)
		if err := selfupdate.ActivateAndRestart(*pendingUpdate); err != nil {
			slog.Error("activate server update failed", "error", err)
			os.Exit(1)
		}
	}
}
