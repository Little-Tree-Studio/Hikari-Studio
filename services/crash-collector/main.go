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
)

func main() {
	if err := run(); err != nil {
		slog.Error("crash collector stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	settings, err := settingsFromEnv()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	repository, err := newPostgresRepository(ctx, settings.databaseURL)
	if err != nil {
		return err
	}
	defer repository.Close()

	store, err := newS3ObjectStore(settings)
	if err != nil {
		return err
	}

	initializeCtx, cancelInitialize := context.WithTimeout(ctx, 30*time.Second)
	defer cancelInitialize()
	if err := repository.Initialize(initializeCtx); err != nil {
		return err
	}
	if err := store.Initialize(initializeCtx); err != nil {
		return err
	}

	httpServer := &http.Server{
		Addr:              ":8080",
		Handler:           newServer(settings, repository, store),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("crash collector listening", "address", httpServer.Addr)
		serverErrors <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
		shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelShutdown()
		return httpServer.Shutdown(shutdownCtx)
	}
}
