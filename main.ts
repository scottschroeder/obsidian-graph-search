import { App, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

import * as plugin from "./pkg/obsidian_rust_plugin";
import wasmBinary from "./pkg/obsidian_rust_plugin_bg.wasm";

import { GraphQueryModal } from "./src/ui/query-modal";
import type { SearchDocumentInput } from "./src/ui/types";
import {
	buildDanglingGraphInput,
	GraphEdgeInput,
	GraphNodeInput,
} from "./src/link-utils";
import { collectFrontmatterTags, splitTagString } from "./src/tag-utils";

interface GraphSearchPluginSettings {
	scoreWeightDistance: number;
	scoreWeightTitle: number;
	scoreWeightBody: number;
	scoreDistanceFalloff: number;
	scoreConnectionStrength: number;
	scoreDistanceCurve: string;
	debugMode: boolean;
}

const DEFAULT_SETTINGS: GraphSearchPluginSettings = {
	scoreWeightDistance: 5.0,
	scoreWeightTitle: 3.0,
	scoreWeightBody: 1.0,
	scoreDistanceFalloff: 0.1,
	scoreConnectionStrength: 0.9,
	scoreDistanceCurve: "exponential",
	debugMode: false,
};

export default class GraphSearchPlugin extends Plugin {
	settings: GraphSearchPluginSettings;
	private searchContentByPath = new Map<string, string>();

	async onload() {
		await this.loadSettings();
		this.addCommand({
			id: "query",
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

	onunload() {
		this.searchContentByPath.clear();
		try {
			plugin.cleanup_all();
		} catch (e) {
			// WASM cleanup failed, not critical
		}
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
		const dangling = buildDanglingGraphInput({
			unresolvedLinks: this.app.metadataCache.unresolvedLinks,
			existingPaths: files.map((file) => file.path),
			existingTitles: files.map((file) => file.basename),
		});
		nodes.push(...dangling.nodes);
		edges.push(...dangling.edges);

		await plugin.graph_init(nodes, edges);
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
		await plugin.search_index(docs);
	}

	getSearchContent(path: string): string {
		return this.searchContentByPath.get(path) ?? "";
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

class GraphSearchSettingTab extends PluginSettingTab {
	plugin: GraphSearchPlugin;

	constructor(app: App, plugin: GraphSearchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl).setName("Advanced scoring").setHeading();

		new Setting(containerEl)
			.setName("Reset scoring defaults")
			.setDesc("Restore all scoring settings to the built-in defaults")
			.addButton((button) =>
				button.setButtonText("Reset").onClick(async () => {
					this.plugin.settings = { ...DEFAULT_SETTINGS };
					await this.plugin.saveSettings();
					this.display();
				}),
			);

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
			.setDesc(
				`How much graph distance contributes to score (default ${DEFAULT_SETTINGS.scoreWeightDistance})`,
			)
			.addText((text) =>
				text
					.setPlaceholder(
						String(DEFAULT_SETTINGS.scoreWeightDistance),
					)
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
			.setDesc(
				`How much title matches contribute to score (default ${DEFAULT_SETTINGS.scoreWeightTitle})`,
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.scoreWeightTitle))
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
			.setDesc(
				`How much body matches contribute to score (default ${DEFAULT_SETTINGS.scoreWeightBody})`,
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.scoreWeightBody))
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
			.setDesc(
				`Controls how quickly distance score drops after 1-hop (default ${DEFAULT_SETTINGS.scoreDistanceFalloff})`,
			)
			.addText((text) =>
				text
					.setPlaceholder(
						String(DEFAULT_SETTINGS.scoreDistanceFalloff),
					)
					.setValue(String(this.plugin.settings.scoreDistanceFalloff))
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreDistanceFalloff = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Distance curve")
			.setDesc(
				`How distance scores decay across hops (default ${DEFAULT_SETTINGS.scoreDistanceCurve})`,
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("exponential", "Exponential")
					.addOption("reciprocal", "Reciprocal")
					.addOption("power", "Power")
					.setValue(this.plugin.settings.scoreDistanceCurve)
					.onChange(async (value) => {
						this.plugin.settings.scoreDistanceCurve = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Connection strength")
			.setDesc(
				`Penalizes paths that pass through high-degree notes (0 disables, default ${DEFAULT_SETTINGS.scoreConnectionStrength})`,
			)
			.addText((text) =>
				text
					.setPlaceholder(
						String(DEFAULT_SETTINGS.scoreConnectionStrength),
					)
					.setValue(
						String(this.plugin.settings.scoreConnectionStrength),
					)
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreConnectionStrength =
								parsed;
							await this.plugin.saveSettings();
						}
					}),
			);
	}
}
