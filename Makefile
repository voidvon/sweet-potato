ROOT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
GO_DIR := $(ROOT_DIR)/backend
GO_BIN := $(GO_DIR)/bin/sweet-potato
VERSION := $(shell tr -d '\r\n' < $(ROOT_DIR)/VERSION)
GO_VERSION_LDFLAG := -X sweet-potato-go/internal/buildinfo.Version=$(VERSION)
FRONTEND_DIR := $(ROOT_DIR)/frontend
FRONTEND_DIST_DIR := $(FRONTEND_DIR)/dist
STATIC_DIR := $(GO_DIR)/internal/httpapi/static
STATIC_WEB_DIR := $(STATIC_DIR)/web

.PHONY: build build-with-plugins prepare-plugins package-plugins embed-plugin-source embed-static clean-embedded-static run dev dev-web test test-plugins vet fmt check

build:
	set -e; \
	trap 'rm -rf "$(STATIC_WEB_DIR)" "$(FRONTEND_DIST_DIR)" "$(GO_DIR)/internal/pluginruntime/remotion-plugin-source.tar.gz"' EXIT; \
	$(MAKE) embed-static; \
	$(MAKE) embed-plugin-source; \
	mkdir -p "$(GO_DIR)/bin"; \
	cd "$(GO_DIR)" && CGO_ENABLED=0 go build -tags embedded_plugin_source -trimpath -ldflags='-s -w $(GO_VERSION_LDFLAG)' -o bin/sweet-potato ./cmd/sweetpotato

build-with-plugins:
	$(MAKE) build
	$(MAKE) package-plugins

prepare-plugins:
	cd "$(ROOT_DIR)/plugins/remotion-video" && bun install --frozen-lockfile && bun run browser:ensure

package-plugins:
	bash "$(ROOT_DIR)/scripts/package-remotion-plugin.sh"

embed-plugin-source:
	bash "$(ROOT_DIR)/scripts/embed-remotion-plugin-source.sh"

embed-static:
	cd "$(FRONTEND_DIR)" && npm run build
	rm -rf "$(STATIC_WEB_DIR)"
	mkdir -p "$(STATIC_WEB_DIR)"
	cp -R "$(FRONTEND_DIR)/dist/." "$(STATIC_WEB_DIR)/"

clean-embedded-static:
	rm -rf "$(STATIC_WEB_DIR)"
	rm -rf "$(FRONTEND_DIST_DIR)"

run:
	set -e; \
	trap 'rm -rf "$(STATIC_WEB_DIR)" "$(FRONTEND_DIST_DIR)"' EXIT; \
	$(MAKE) embed-static; \
	cd "$(GO_DIR)" && CGO_ENABLED=0 go run -ldflags='$(GO_VERSION_LDFLAG)' ./cmd/sweetpotato

dev:
	bash "$(ROOT_DIR)/scripts/dev.sh"

dev-web:
	bash "$(ROOT_DIR)/scripts/dev.sh"

test:
	cd "$(GO_DIR)" && CGO_ENABLED=0 go test ./...

test-plugins:
	cd "$(ROOT_DIR)/plugins/remotion-video" && bun run test && bun run lint

vet:
	cd "$(GO_DIR)" && CGO_ENABLED=0 go vet ./...

fmt:
	cd "$(GO_DIR)" && gofmt -w cmd internal

check:
	@unformatted=$$(cd "$(GO_DIR)" && gofmt -l cmd internal); test -z "$$unformatted" || { echo "unformatted Go files:"; echo "$$unformatted"; exit 1; }
	$(MAKE) test
	$(MAKE) test-plugins
	$(MAKE) vet
