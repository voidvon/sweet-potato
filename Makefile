GO_DIR := backend/go
GO_BIN := $(GO_DIR)/bin/ai-marketing

.PHONY: build run test vet fmt check

build:
	mkdir -p $(GO_DIR)/bin
	cd $(GO_DIR) && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/ai-marketing ./cmd/aimarketing

run:
	cd $(GO_DIR) && CGO_ENABLED=0 go run ./cmd/aimarketing

test:
	cd $(GO_DIR) && CGO_ENABLED=0 go test ./...

vet:
	cd $(GO_DIR) && CGO_ENABLED=0 go vet ./...

fmt:
	cd $(GO_DIR) && gofmt -w cmd internal

check:
	@unformatted=$$(cd $(GO_DIR) && gofmt -l cmd internal); test -z "$$unformatted" || { echo "unformatted Go files:"; echo "$$unformatted"; exit 1; }
	$(MAKE) test
	$(MAKE) vet
