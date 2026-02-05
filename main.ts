import { Plugin } from "obsidian";

import * as plugin from "./pkg/obsidian_rust_plugin";
import wasmBinary from "./pkg/obsidian_rust_plugin_bg.wasm";

import { GraphQueryModal } from "./ui/query-modal";
import type { SearchDocumentInput } from "./ui/types";
import {
	buildDanglingGraphInput,
	GraphEdgeInput,
	GraphNodeInput,
} from "./ui/link-utils";
import { buildDisplayTitleMap } from "./ui/metadata/display-titles";
import { collectFileTags } from "./ui/metadata/tags";
import {
	DEFAULT_SETTINGS,
	GraphSearchPluginSettings,
	GraphSearchSettingTab,
} from "./ui/settings";

export default class GraphSearchPlugin extends Plugin {
	settings: GraphSearchPluginSettings;
	private searchContentByPath = new Map<string, string>();
	private displayTitleByPath = new Map<string, string>();
	private activeModal?: GraphQueryModal;

	async onload() {
		await this.loadSettings();
		this.addCommand({
			id: "query",
			name: "Graph query",
			callback: () => {
				if (this.activeModal) {
					this.activeModal.focusInput();
					return;
				}
				this.activeModal = new GraphQueryModal(this.app, this);
				this.activeModal.open();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GraphSearchSettingTab(this.app, this));

		// here's the Rust bit
		await plugin.default({ module_or_path: Promise.resolve(wasmBinary) });
	}

	onunload() {
		this.searchContentByPath.clear();
		try {
			plugin.cleanup_all();
		} catch (error) {
			void error;
			// WASM cleanup failed, not critical
		}
	}

	clearIndexes() {
		this.searchContentByPath.clear();
		this.displayTitleByPath.clear();
		try {
			plugin.cleanup_all();
		} catch (error) {
			void error;
			// WASM cleanup failed, not critical
		}
	}

	clearActiveModal() {
		this.activeModal = undefined;
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getScoreWeights() {
		return {
			distance_weight: this.settings.scoreWeightDistance,
			title_weight: this.settings.scoreWeightTitle,
			body_weight: this.settings.scoreWeightBody,
			distance_falloff: this.settings.scoreDistanceFalloff,
			connection_strength: this.settings.scoreConnectionStrength,
			distance_curve: this.settings.scoreDistanceCurve,
		};
	}

	isDebugMode() {
		return this.settings.debugMode;
	}

	async buildGraphIndex(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		this.displayTitleByPath = buildDisplayTitleMap(files);
		const nodes: GraphNodeInput[] = files.map((file) => ({
			path: file.path,
		}));

		const edges: GraphEdgeInput[] = [];
		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		for (const [fromPath, targets] of Object.entries(resolvedLinks)) {
			for (const toPath of Object.keys(targets)) {
				edges.push({ from: fromPath, to: toPath });
			}
		}
		const dangling = buildDanglingGraphInput({
			unresolvedLinks: this.app.metadataCache.unresolvedLinks,
			existingPaths: files.map((file) => file.path),
			existingTitles: files.map((file) => file.basename),
		});
		nodes.push(...dangling.nodes);
		edges.push(...dangling.edges);

		plugin.graph_init(nodes, edges);
	}

	async buildSearchIndex(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const docs: SearchDocumentInput[] = [];
		this.searchContentByPath = new Map();
		for (const file of files) {
			const body = await this.app.vault.cachedRead(file);
			const tagTokens = collectFileTags(this.app, file);
			docs.push({
				title: file.basename,
				path: file.path,
				body,
				tags: tagTokens,
			});
			this.searchContentByPath.set(file.path, body);
		}
		plugin.search_index(docs);
	}

	getSearchContent(path: string): string {
		return this.searchContentByPath.get(path) ?? "";
	}

	getDisplayTitle(path: string): string {
		if (!this.displayTitleByPath.has(path)) {
			this.displayTitleByPath = buildDisplayTitleMap(
				this.app.vault.getMarkdownFiles(),
			);
		}
		return this.displayTitleByPath.get(path) ?? path;
	}
}
