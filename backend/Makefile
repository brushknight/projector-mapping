.PHONY: help dev build web test test-race lint fmt catalog run sim clean release release-bins

GO      := GOTOOLCHAIN=local go
BIN     := projmap
LDFLAGS := -s -w
# VERSION (e.g. 0.2.0) is stamped into `projmap version`; empty keeps the default in internal/config.
VERSION ?=
ifneq ($(VERSION),)
LDFLAGS += -X projmap/internal/config.Version=$(VERSION)
endif
PLATFORMS ?= darwin/arm64 darwin/amd64 linux/amd64 linux/arm64
DIST      ?= $(CURDIR)/../dist

help:
	@grep -E '^[a-z-]+:.*##' Makefile | sed 's/:.*##/ ·/'

dev: catalog ## run the server on :7400 against ./.data (Vite on :5410 proxies to it: cd ../frontend && npm run dev)
	PROJMAP_DATA=$(CURDIR)/.data $(GO) run ./cmd/projmap serve

web: ## build the React app into internal/web/dist (when ../frontend exists)
	@if [ -f ../frontend/package.json ]; then cd ../frontend && npm ci && npm run build; else echo "no ../frontend: serving the placeholder page"; fi

build: catalog web ## one binary with the web app embedded (CGO off)
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags="$(LDFLAGS)" -o $(BIN) ./cmd/projmap

test: catalog ## go tests (unit, API over HTTP and WebSocket, contract, vision)
	$(GO) test ./...

test-race: catalog ## the same with the race detector (slow: the vision tests take about a minute)
	CGO_ENABLED=1 $(GO) test -race ./...

lint: ## go vet + gofmt check
	$(GO) vet ./...
	@test -z "$$(gofmt -l internal cmd)" || (gofmt -l internal cmd; echo "run make fmt"; exit 1)

fmt:
	gofmt -w internal cmd

catalog: ## copy contract/catalog.json, contract/fixtures and docs/effects.md into the module (go:embed cannot reach ../)
	@mkdir -p internal/catalog/fixtures internal/catalog/docs
	@cp ../contract/catalog.json internal/catalog/catalog.json
	@rm -f internal/catalog/fixtures/*.json && cp ../contract/fixtures/*.json internal/catalog/fixtures/
	@cp ../docs/effects.md internal/catalog/docs/effects.md

run: build ## build and serve
	./$(BIN) serve

sim: ## fake phone + camera + output against the running server
	$(GO) run ./cmd/projmap sim

clean:
	rm -f $(BIN)

release: catalog web release-bins ## build the web app once, then release tarballs + SHA256SUMS in ../dist (VERSION=0.2.0)

release-bins: ## the tarballs and SHA256SUMS only, with the web app already in internal/web/dist
	@test -n "$(VERSION)" || (echo "set VERSION, e.g. make release VERSION=0.2.0"; exit 1)
	@test -f internal/web/dist/index.html || (echo "no web build in internal/web/dist: run make web first"; exit 1)
	@rm -rf $(DIST) && mkdir -p $(DIST)
	@set -e; for t in $(PLATFORMS); do \
	  os=$${t%/*}; arch=$${t#*/}; dir=$(DIST)/projmap_$(VERSION)_$${os}_$${arch}; \
	  mkdir -p $$dir; \
	  CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch $(GO) build -trimpath -ldflags="$(LDFLAGS)" -o $$dir/projmap ./cmd/projmap; \
	  cp ../LICENSE ../README.md $$dir/; \
	  tar -czf $$dir.tar.gz -C $$dir projmap LICENSE README.md; rm -rf $$dir; \
	  echo "  $$(basename $$dir).tar.gz"; \
	done
	@cd $(DIST) && shasum -a 256 *.tar.gz > SHA256SUMS && cat SHA256SUMS

install: build ## copy ./projmap to ~/.local/bin (remove first: overwriting a running or cached binary in place makes macOS kill it)
	@mkdir -p $(HOME)/.local/bin
	@rm -f $(HOME)/.local/bin/projmap
	cp $(BIN) $(HOME)/.local/bin/projmap
	@echo "installed $(HOME)/.local/bin/projmap; restart the server: pkill -f 'projmap serve'; projmap serve"
