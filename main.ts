import {
	App,
	Editor,
	FuzzySuggestModal,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

import * as plugin from "./pkg/obsidian_rust_plugin";
import wasmBinary from "./pkg/obsidian_rust_plugin_bg.wasm";

// Remember to rename these classes and interfaces!

interface GraphSearchPluginSettings {
	mySetting: string;
}

type GraphNodeInput = {
	title: string;
	path: string;
};

type GraphEdgeInput = {
	from: string;
	to: string;
};

type GraphStats = {
	node_count: number;
	edge_count: number;
};

type ParsedQuery = {
	near_titles: string[];
	base_query: string;
};

type CandidateInput = {
	title: string;
	path: string;
};

type ScoredCandidate = {
	title: string;
	path: string;
	distance_sum: number;
};

type DistanceEntry = {
	title: string;
	path: string;
	distance: number | null;
};

const DEFAULT_SETTINGS: GraphSearchPluginSettings = {
	mySetting: "default",
};

export default class GraphSearchPlugin extends Plugin {
	settings: GraphSearchPluginSettings;

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

function openTitlePicker(
	app: App,
	onSelect: (value: string) => void,
	onCancel?: () => void,
) {
	const modal = new NoteTitleSuggestModal(app, onSelect, onCancel);
	modal.open();
}

function buildNoteTitleItems(app: App): NoteTitleItem[] {
	const files = app.vault.getMarkdownFiles();
	const counts = new Map<string, number>();

	files.forEach((file) => {
		counts.set(file.basename, (counts.get(file.basename) ?? 0) + 1);
	});

	return files.map((file) => {
		const hasDuplicate = (counts.get(file.basename) ?? 0) > 1;
		const value = file.path;
		const label = hasDuplicate
			? `${file.basename} - ${file.path}`
			: file.basename;
		return {
			title: file.basename,
			path: file.path,
			value,
			label,
		};
	});
}

function findTokenAtCursor(
	value: string,
	cursor: number,
): { start: number; end: number; token: string } | null {
	if (value.length === 0) {
		return null;
	}
	const safeCursor = Math.max(0, Math.min(cursor, value.length));
	let start = safeCursor;
	while (start > 0 && !/\s/.test(value[start - 1])) {
		start -= 1;
	}
	let end = safeCursor;
	while (end < value.length && !/\s/.test(value[end])) {
		end += 1;
	}
	const token = value.slice(start, end);
	return token.length > 0 ? { start, end, token } : null;
}

function formatNearValue(value: string): string {
	const trimmed = value.trim();
	return trimmed.includes(" ") ? `"${trimmed}"` : trimmed;
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

class GraphQueryModal extends Modal {
	private plugin: GraphSearchPlugin;
	private inputEl?: HTMLInputElement;
	private resultsEl?: HTMLDivElement;
	private statusEl?: HTMLDivElement;
	private isSuggesting = false;

	constructor(app: App, plugin: GraphSearchPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Graph query" });

		this.inputEl = contentEl.createEl("input", {
			type: "text",
			placeholder: "budget tag:#meeting near:ExactFile",
		});

		this.statusEl = contentEl.createDiv({ cls: "graph-search-status" });
		this.resultsEl = contentEl.createDiv({ cls: "graph-search-results" });

		this.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				this.runQuery();
			}
		});

		this.inputEl.addEventListener("input", () => {
			this.maybeSuggestNear();
		});

		this.inputEl.focus();
	}

	onClose() {
		this.contentEl.empty();
	}

	private maybeSuggestNear() {
		if (!this.inputEl || this.isSuggesting) {
			return;
		}

		const cursor = this.inputEl.selectionStart ?? this.inputEl.value.length;
		const tokenInfo = findTokenAtCursor(this.inputEl.value, cursor);
		if (!tokenInfo) {
			return;
		}
		if (!tokenInfo.token.startsWith("near:")) {
			return;
		}
		const afterPrefix = tokenInfo.token.slice(5);
		if (afterPrefix.length > 0) {
			return;
		}

		this.isSuggesting = true;
		openTitlePicker(
			this.app,
			(selected) => {
				if (!this.inputEl) {
					this.isSuggesting = false;
					return;
				}
				const formatted = formatNearValue(selected);
				const before = this.inputEl.value.slice(0, tokenInfo.start);
				const after = this.inputEl.value.slice(tokenInfo.end);
				const replacement = `near:${formatted}`;
				this.inputEl.value = `${before}${replacement}${after}`;
				const newCursor = before.length + replacement.length;
				this.inputEl.setSelectionRange(newCursor, newCursor);
				this.inputEl.focus();
				this.isSuggesting = false;
			},
			() => {
				this.isSuggesting = false;
			},
		);
	}

	private async runQuery() {
		if (!this.inputEl || !this.resultsEl || !this.statusEl) {
			return;
		}
		const rawQuery = this.inputEl.value.trim();
		if (!rawQuery) {
			new Notice("Enter a query first");
			return;
		}

		try {
			await this.plugin.buildGraphIndex();
			const parsed = plugin.parse_query(rawQuery) as ParsedQuery;
			const candidates = await this.plugin.getCandidates(parsed.base_query);
			const scored = (await plugin.graph_rank_candidates(
				parsed.near_titles,
				candidates,
			)) as ScoredCandidate[];

			this.renderResults(scored, candidates.length, parsed.near_titles);
		} catch (error) {
			console.error("Graph query failed", error);
			new Notice("Graph query failed; see console");
		}
	}

	private renderResults(
		results: ScoredCandidate[],
		candidateCount: number,
		nearTitles: string[],
	) {
		if (!this.resultsEl || !this.statusEl) {
			return;
		}

		this.resultsEl.empty();
		this.statusEl.setText(
			`Candidates: ${candidateCount}, Near: ${nearTitles.length}, Results: ${results.length}`,
		);

		if (results.length === 0) {
			this.resultsEl.createEl("div", { text: "No results." });
			return;
		}

		const list = this.resultsEl.createEl("ol");
		results.slice(0, 50).forEach((entry) => {
			list.createEl("li", {
				text: `${entry.distance_sum} - ${entry.title} (${entry.path})`,
			});
		});
	}
}

type NoteTitleItem = {
	title: string;
	path: string;
	value: string;
	label: string;
};

class NoteTitleSuggestModal extends FuzzySuggestModal<NoteTitleItem> {
	private onSelect: (value: string) => void;
	private onCancel?: () => void;
	private items: NoteTitleItem[];
	private submitted = false;

	constructor(
		app: App,
		onSelect: (value: string) => void,
		onCancel?: () => void,
	) {
		super(app);
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.items = buildNoteTitleItems(app);
		this.setPlaceholder("Type a note title");
	}

	getItems(): NoteTitleItem[] {
		return this.items;
	}

	getItemText(item: NoteTitleItem): string {
		return item.label;
	}

	onChooseItem(item: NoteTitleItem, _evt: MouseEvent | KeyboardEvent): void {
		this.submitted = true;
		this.onSelect(item.value);
	}

	onClose(): void {
		super.onClose();
		if (!this.submitted && this.onCancel) {
			this.onCancel();
		}
	}
}

class GraphDistancesModal extends Modal {
	private title: string;
	private entries: DistanceEntry[];

	constructor(app: App, title: string, entries: DistanceEntry[]) {
		super(app);
		this.title = title;
		this.entries = entries;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: `Distances from: ${this.title}`,
		});

		const list = contentEl.createEl("ul");
		this.entries.slice(0, 25).forEach((entry) => {
			const label =
				entry.distance === null
					? "unreachable"
					: entry.distance.toString();
			list.createEl("li", {
				text: `${label} - ${entry.title} (${entry.path})`,
			});
		});
	}

	onClose() {
		this.contentEl.empty();
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

		containerEl.createEl("h2", { text: "Settings for my awesome plugin." });

		new Setting(containerEl)
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						console.log("Secret: " + value);
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
