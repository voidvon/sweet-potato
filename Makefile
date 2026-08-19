ROOT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
GO_DIR := $(ROOT_DIR)/backend
GO_BIN := $(GO_DIR)/bin/ai-marketing
FRONTEND_WEB_DIR := $(ROOT_DIR)/frontend/web
FRONTEND_DIST_DIR := $(FRONTEND_WEB_DIR)/dist
STATIC_DIR := $(GO_DIR)/internal/httpapi/static
STATIC_WEB_DIR := $(STATIC_DIR)/web

.PHONY: build embed-static clean-embedded-static run dev dev-web dev-electron test vet fmt check

build:
	set -e; \
	trap 'rm -rf "$(STATIC_WEB_DIR)" "$(FRONTEND_DIST_DIR)"' EXIT; \
	$(MAKE) embed-static; \
	mkdir -p "$(GO_DIR)/bin"; \
	cd "$(GO_DIR)" && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/ai-marketing ./cmd/aimarketing

embed-static:
	cd "$(FRONTEND_WEB_DIR)" && pnpm run build
	rm -rf "$(STATIC_WEB_DIR)"
	mkdir -p "$(STATIC_WEB_DIR)"
	cp -R "$(FRONTEND_WEB_DIR)/dist/." "$(STATIC_WEB_DIR)/"

clean-embedded-static:
	rm -rf "$(STATIC_WEB_DIR)"
	rm -rf "$(FRONTEND_DIST_DIR)"

run:
	set -e; \
	trap 'rm -rf "$(STATIC_WEB_DIR)" "$(FRONTEND_DIST_DIR)"' EXIT; \
	$(MAKE) embed-static; \
	cd "$(GO_DIR)" && CGO_ENABLED=0 go run ./cmd/aimarketing

dev:
	bash "$(ROOT_DIR)/scripts/dev.sh"

dev-web:
	bash "$(ROOT_DIR)/scripts/dev.sh" --web

dev-electron:
	bash "$(ROOT_DIR)/scripts/dev.sh" --electron

test:
	cd "$(GO_DIR)" && CGO_ENABLED=0 go test ./...

vet:
	cd "$(GO_DIR)" && CGO_ENABLED=0 go vet ./...

fmt:
	cd "$(GO_DIR)" && gofmt -w cmd internal

check:
	@unformatted=$$(cd "$(GO_DIR)" && gofmt -l cmd internal); test -z "$$unformatted" || { echo "unformatted Go files:"; echo "$$unformatted"; exit 1; }
	$(MAKE) test
	$(MAKE) vet
