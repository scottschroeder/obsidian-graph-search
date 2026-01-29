import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";

import * as plugin from "./pkg/obsidian_rust_plugin";
import wasmBinary from "./pkg/obsidian_rust_plugin_bg.wasm";

import { GraphDistancesModal } from "./src/ui/distances-modal";
import { GraphQueryModal } from "./src/ui/query-modal";
import { openTitlePicker } from "./src/ui/title-suggest";
import type {
	CandidateInput,
	DistanceEntry,
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

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"dice",
			"Graph Search",
			(evt: MouseEvent) => {
				// Called when the user clicks the icon.
				new Notice("This is a notice!");
			},
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("Status Bar Text");

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "open-graph-search-modal-simple",
			name: "Open graph search modal (simple)",
			callback: () => {
				new GraphSearchModal(this.app).open();
			},
		});
		this.addCommand({
			id: "graph-search-build-graph",
			name: "Build graph index",
			callback: async () => {
				const stats = await this.buildGraphIndex();
				new Notice(
					`Graph indexed: ${stats.node_count} nodes, ${stats.edge_count} edges`,
				);
			},
		});
		this.addCommand({
			id: "graph-search-dump-debug",
			name: "Dump graph debug",
			callback: async () => {
				try {
					await this.buildGraphIndex();
					const dump = plugin.graph_debug_dump() as string;
					const path = "graph-search-debug.json";
					await this.app.vault.adapter.write(path, dump);
					new Notice(`Wrote debug dump to ${path}`);
				} catch (error) {
					console.error("Graph debug dump failed", error);
					new Notice("Graph debug dump failed; see console");
				}
			},
		});
		this.addCommand({
			id: "graph-search-show-distances",
			name: "Distances from title",
			callback: async () => {
				openTitlePicker(this.app, async (input) => {
					try {
						const title = normalizeTitleInput(input);

						await this.buildGraphIndex();
						const entries = (await plugin.graph_distances_from_title(
							title,
						)) as DistanceEntry[];
						const hasSource = entries.some(
							(entry) => entry.distance === 0,
						);
						if (!hasSource) {
							new Notice(`No match found for: ${title}`);
							return;
						}
						new GraphDistancesModal(this.app, title, entries).open();
					} catch (error) {
						console.error("Graph distance lookup failed", error);
						new Notice("Graph distance lookup failed; see console");
					}
				});
			},
		});
		this.addCommand({
			id: "graph-search-query",
			name: "Graph query",
			callback: () => {
				new GraphQueryModal(this.app, this).open();
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "graph-search-editor-command",
			name: "Graph search editor command",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection("Graph Search Editor Command");
			},
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "open-graph-search-modal-complex",
			name: "Open graph search modal (complex)",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new GraphSearchModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GraphSearchSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000),
		);

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

function normalizeTitleInput(value: string): string {
	let normalized = value.trim();
	if (!normalized.includes("/") && normalized.toLowerCase().endsWith(".md")) {
		normalized = normalized.slice(0, -3);
	}
	return normalized;
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

class GraphSearchModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
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
