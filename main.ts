import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";

import * as plugin from "./pkg/obsidian_rust_plugin";
import wasmBinary from "./pkg/obsidian_rust_plugin_bg.wasm";

import { GraphQueryModal } from "./src/ui/query-modal";
import type {
	CandidateInput,
	GraphStats,
	SearchDocumentInput,
	SearchStats,
} from "./src/ui/types";

// Remember to rename these classes and interfaces!

interface GraphSearchPluginSettings {
	scoreWeightDistance: number;
	scoreWeightTitle: number;
	scoreWeightBody: number;
	scoreDistanceFalloff: number;
	debugMode: boolean;
}

type GraphNodeInput = {
	title: string;
	path: string;
};

type GraphEdgeInput = {
	from: string;
	to: string;
};

const DEFAULT_SETTINGS: GraphSearchPluginSettings = {
	scoreWeightDistance: 1.0,
	scoreWeightTitle: 1.0,
	scoreWeightBody: 1.0,
	scoreDistanceFalloff: 0.5,
	debugMode: false,
};

export default class GraphSearchPlugin extends Plugin {
	settings: GraphSearchPluginSettings;
	private searchContentByPath = new Map<string, string>();

	async onload() {
		await this.loadSettings();
		this.addCommand({
			id: "graph-search-query",
			name: "Graph query",
			callback: () => {
				new GraphQueryModal(this.app, this).open();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GraphSearchSettingTab(this.app, this));

		// here's the Rust bit
		await plugin.default({ module_or_path: Promise.resolve(wasmBinary) });
	}

	onunload() {}

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
		};
	}

	isDebugMode() {
		return this.settings.debugMode;
	}

	async buildGraphIndex(): Promise<GraphStats> {
		const files = this.app.vault.getMarkdownFiles();
		const nodes: GraphNodeInput[] = files.map((file) => ({
			title: file.basename,
			path: file.path,
		}));

		const edges: GraphEdgeInput[] = [];
		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		for (const [fromPath, targets] of Object.entries(resolvedLinks)) {
			for (const toPath of Object.keys(targets)) {
				edges.push({ from: fromPath, to: toPath });
			}
		}

		return plugin.graph_init(nodes, edges) as GraphStats;
	}

	async buildSearchIndex(): Promise<SearchStats> {
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
		return plugin.search_index(docs) as SearchStats;
	}

	getSearchContent(path: string): string {
		return this.searchContentByPath.get(path) ?? "";
	}

	async getCandidates(baseQuery: string): Promise<CandidateInput[]> {
		const files = this.app.vault.getMarkdownFiles();
		const terms = baseQuery
			.trim()
			.split(/\s+/)
			.filter((term) => term.length > 0);
		let candidates = files;

		for (const term of terms) {
			if (term.startsWith("tag:")) {
				const rawTag = term.slice(4);
				const normalized = rawTag.startsWith("#")
					? rawTag
					: `#${rawTag}`;
				candidates = candidates.filter((file) => {
					const cache = this.app.metadataCache.getFileCache(file);
					const tags = cache?.tags ?? [];
					return tags.some((tag) => tag.tag === normalized);
				});
				continue;
			}

			const lowered = term.toLowerCase();
			candidates = candidates.filter((file) => {
				return (
					file.basename.toLowerCase().includes(lowered) ||
					file.path.toLowerCase().includes(lowered)
				);
			});
		}

		return candidates.map((file) => ({
			title: file.basename,
			path: file.path,
			title_score: 0,
			body_score: 0,
		}));
	}
}
function collectFileTags(app: App, file: TFile): string[] {
	const cache = app.metadataCache.getFileCache(file);
	const inlineTags = cache?.tags?.map((tag) => tag.tag) ?? [];
	const frontmatter = cache?.frontmatter?.tags;
	const frontmatterTags = collectFrontmatterTags(frontmatter);
	const combined = [...inlineTags, ...frontmatterTags]
		.flatMap((tag) => splitTagString(tag))
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0)
		.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
	return Array.from(new Set(combined));
}

function collectFrontmatterTags(value: unknown): string[] {
	if (typeof value === "string") {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry));
	}
	return [];
}

function splitTagString(value: string): string[] {
	if (value.includes(",")) {
		return value.split(",");
	}
	return value.split(/\s+/);
}

class GraphSearchSettingTab extends PluginSettingTab {
	plugin: GraphSearchPlugin;

	constructor(app: App, plugin: GraphSearchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Graph Search Settings" });
		containerEl.createEl("h3", { text: "Advanced Scoring" });

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc("Show scoring breakdown in result previews")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Distance weight")
			.setDesc("How much graph distance contributes to score")
			.addText((text) =>
				text
					.setPlaceholder("1.0")
					.setValue(String(this.plugin.settings.scoreWeightDistance))
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreWeightDistance = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Title match weight")
			.setDesc("How much title matches contribute to score")
			.addText((text) =>
				text
					.setPlaceholder("1.0")
					.setValue(String(this.plugin.settings.scoreWeightTitle))
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreWeightTitle = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Body match weight")
			.setDesc("How much body matches contribute to score")
			.addText((text) =>
				text
					.setPlaceholder("1.0")
					.setValue(String(this.plugin.settings.scoreWeightBody))
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreWeightBody = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Distance falloff")
			.setDesc("Controls how quickly distance score drops after 1-hop")
			.addText((text) =>
				text
					.setPlaceholder("0.5")
					.setValue(String(this.plugin.settings.scoreDistanceFalloff))
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreDistanceFalloff = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);
	}
}
