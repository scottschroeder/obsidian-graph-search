SHELL := /bin/bash

CARGO ?= cargo
YARN ?= yarn

VAULT_DIR ?= $(HOME)/Documents/personal
PLUGIN_ID ?= graph-search
PLUGIN_DIR := $(VAULT_DIR)/.obsidian/plugins/$(PLUGIN_ID)

RUST_SRC := $(shell find src -name \*.rs -print)

.PHONY: all preflight deps build dev fix install clean lint fmt test rust-lint rust-fmt rust-fix rust-test js-lint js-fmt js-test

all: build

preflight:
	@command -v $(CARGO) >/dev/null 2>&1 || { echo "cargo not found"; exit 1; }
	@command -v rustc >/dev/null 2>&1 || { echo "rustc not found"; exit 1; }
	@command -v wasm-pack >/dev/null 2>&1 || { echo "wasm-pack not found"; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "node not found"; exit 1; }
	@command -v $(YARN) >/dev/null 2>&1 || { echo "yarn not found"; exit 1; }

deps:
	$(YARN) install

build: preflight
	$(YARN) run build

install: build
	mkdir -p $(PLUGIN_DIR)
	cp main.js manifest.json styles.css $(PLUGIN_DIR)/
	cp -R pkg $(PLUGIN_DIR)/

lint: rust-lint js-lint

rust-lint:
	$(CARGO) clippy

js-lint:
	$(YARN) run lint

fmt: rust-fmt js-fmt

fix: rust-fix

rust-fix:
	$(CARGO) fix --allow-staged
	$(CARGO) clippy --fix --allow-staged --allow-dirty

rust-fmt:
	$(CARGO) +nightly fmt

js-fmt:
	$(YARN) run fmt

test: preflight deps rust-test js-test

rust-test:
	$(CARGO) test

js-test:
	$(YARN) run test

clean:
	$(CARGO) clean
	rm -rf pkg main.js
