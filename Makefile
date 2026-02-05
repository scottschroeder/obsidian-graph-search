SHELL := /bin/bash

CARGO ?= cargo
YARN ?= yarn

VAULT_DIR ?=
PLUGIN_ID ?= graph-search
PLUGIN_DIR := $(VAULT_DIR)/.obsidian/plugins/$(PLUGIN_ID)

RUST_SRC := $(shell find src -name \*.rs -print)
WASM_OUT := pkg/obsidian_rust_plugin_bg.wasm \
	pkg/obsidian_rust_plugin.js \
	pkg/obsidian_rust_plugin.d.ts \
	pkg/package.json \
	pkg/README.md \
	pkg/LICENSE \
	pkg/src_hash.txt
WASM_DEPS := $(RUST_SRC) Cargo.toml Cargo.lock xtask/Cargo.toml xtask/src/main.rs

.PHONY: all preflight deps build dev fix install clean lint fmt test rust-lint rust-fmt rust-fix rust-test js-lint js-fmt js-test version-check wasm

all: build fmt test lint

preflight:
	@command -v $(CARGO) >/dev/null 2>&1 || { echo "cargo not found"; exit 1; }
	@command -v rustc >/dev/null 2>&1 || { echo "rustc not found"; exit 1; }
	@command -v wasm-pack >/dev/null 2>&1 || { echo "wasm-pack not found"; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "node not found"; exit 1; }
	@command -v $(YARN) >/dev/null 2>&1 || { echo "yarn not found"; exit 1; }

deps:
	$(YARN) install

build: preflight deps
	$(MAKE) wasm
	$(YARN) run build

wasm: $(WASM_OUT)

$(WASM_OUT): $(WASM_DEPS)
	$(CARGO) run --package xtask -- wasm build

install: build
	@if [ -z "$(VAULT_DIR)" ]; then echo "VAULT_DIR is not set"; exit 1; fi
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

test: build rust-test js-test 

rust-test:
	$(CARGO) test

js-test:
	$(YARN) run test

clean:
	$(CARGO) clean
	rm -rf pkg main.js

version-check:
	$(CARGO) run --package xtask -- version check
