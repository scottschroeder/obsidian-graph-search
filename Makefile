.PHONY: build dev install

VAULT_DIR ?= $(HOME)/Documents/personal
PLUGIN_ID ?= obsidian-sample-plugin
PLUGIN_DIR := $(VAULT_DIR)/.obsidian/plugins/$(PLUGIN_ID)

build:
	yarn run build

dev:
	yarn run dev

install: build
	mkdir -p $(PLUGIN_DIR)
	cp main.js manifest.json styles.css $(PLUGIN_DIR)/
	cp -R pkg $(PLUGIN_DIR)/
