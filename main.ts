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
	TFile,
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

type QueryLayout = {
	near_spans: NearSpan[];
};

type NearSpan = {
	start: number;
	end: number;
	text: string;
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

type SearchDocumentInput = {
	title: string;
	path: string;
	body: string;
};

type SearchStats = {
	doc_count: number;
	token_count: number;
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
			docs.push({
				title: file.basename,
				path: file.path,
				body,
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
		const value = hasDuplicate
			? stripMdExtension(file.path)
			: file.basename;
		const label = hasDuplicate
			? `${file.basename} - ${stripMdExtension(file.path)}`
			: file.basename;
		return {
			title: file.basename,
			path: hasDuplicate ? stripMdExtension(file.path) : file.basename,
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
	const trimmed = stripMdExtension(value.trim());
	return trimmed.includes(" ") ? `"${trimmed}"` : trimmed;
}

function extractSearchTerms(baseQuery: string): string[] {
	return baseQuery
		.split(/\s+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0)
		.map((term) => {
			if (term.startsWith("tag:")) {
				return term.slice(4);
			}
			if (term.startsWith("path:")) {
				return term.slice(5);
			}
			if (term.startsWith("file:")) {
				return term.slice(5);
			}
			return term;
		})
		.filter((term) => term.length > 0);
}

function buildSnippet(body: string, terms: string[]): string {
	if (!body) {
		return "";
	}
	const cleaned = body.replace(/\s+/g, " ").trim();
	if (!cleaned) {
		return "";
	}
	const lowered = cleaned.toLowerCase();
	let matchIndex = -1;
	let matchLength = 0;
	for (const term of terms) {
		const normalized = term.replace(/^#/, "").toLowerCase();
		if (!normalized) {
			continue;
		}
		const index = lowered.indexOf(normalized);
		if (index >= 0 && (matchIndex === -1 || index < matchIndex)) {
			matchIndex = index;
			matchLength = normalized.length;
		}
	}
	const windowSize = 120;
	let start = 0;
	if (matchIndex >= 0) {
		start = Math.max(0, matchIndex - Math.floor(windowSize / 2));
	}
	const snippet = cleaned.slice(start, start + windowSize);
	return highlightSnippet(snippet, terms);
}

function highlightSnippet(snippet: string, terms: string[]): string {
	let result = escapeHtml(snippet);
	for (const term of terms) {
		const normalized = term.replace(/^#/, "");
		if (!normalized) {
			continue;
		}
		const pattern = new RegExp(escapeRegExp(normalized), "gi");
		result = result.replace(pattern, (match) => {
			return `<span class="graph-search-highlight">${match}</span>`;
		});
	}
	return result;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripMdExtension(value: string): string {
	return value.toLowerCase().endsWith(".md") ? value.slice(0, -3) : value;
}

function isColonInsert(event: Event): boolean {
	if (!(event instanceof InputEvent)) {
		return false;
	}
	return event.inputType === "insertText" && event.data === ":";
}

function buildOverlayHtml(
	value: string,
	spans: NearSpan[],
	placeholder?: string,
): string {
	if (!value) {
		const text = placeholder ? escapeHtml(placeholder) : "";
		return `<span class="graph-search-placeholder">${text}</span>`;
	}
	const sorted = [...spans].sort((a, b) => a.start - b.start);
	let html = "";
	let lastIndex = 0;

	for (const span of sorted) {
		let beforeEnd = span.start;
		if (span.start > 0 && value[span.start - 1] === '"') {
			beforeEnd = span.start - 1;
		}
		html += escapeHtml(value.slice(lastIndex, beforeEnd));
		html += `<span class="graph-search-chip">${escapeHtml(span.text)}</span>`;
		lastIndex = span.end;
		if (value[span.end] === '"') {
			lastIndex = span.end + 1;
		}
	}

	html += escapeHtml(value.slice(lastIndex));
	return html;
}

function findSpanAtCursor(spans: NearSpan[], cursor: number): NearSpan | null {
	return (
		spans.find(
			(span) => cursor >= span.start && cursor <= span.end,
		) ?? null
	);
}

function findNearTokenRange(
	value: string,
	span: NearSpan,
): { start: number; end: number } | null {
	let start = span.start;
	while (start > 0 && !/\s/.test(value[start - 1])) {
		start -= 1;
	}
	let end = span.end;
	if (value[span.end] === '"') {
		end = span.end + 1;
	}
	const token = value.slice(start, end);
	if (!token.startsWith("near:")) {
		return null;
	}
	return { start, end };
}

function removeRange(
	value: string,
	start: number,
	end: number,
): { value: string; cursor: number } {
	let newValue = value.slice(0, start) + value.slice(end);
	let cursor = start;
	if (start > 0 && newValue[start - 1] === " " && newValue[start] === " ") {
		newValue = newValue.slice(0, start) + newValue.slice(start + 1);
		cursor = start;
	}
	return { value: newValue, cursor: Math.min(cursor, newValue.length) };
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
	private results: ScoredCandidate[] = [];
	private selectedIndex = -1;
	private debounceHandle?: number;
	private graphReady = false;
	private searchReady = false;
	private lastCandidateCount = 0;
	private lastNearTitles: string[] = [];
	private lastSearchTerms: string[] = [];
	private layout: QueryLayout = { near_spans: [] };
	private overlayEl?: HTMLDivElement;

	constructor(app: App, plugin: GraphSearchPlugin) {
		super(app);
		this.plugin = plugin;
	}

		onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("prompt");

		const inputWrapper = contentEl.createDiv({
			cls: "graph-search-input-wrapper",
		});
		this.overlayEl = inputWrapper.createDiv({
			cls: "graph-search-input-overlay",
		});
		this.inputEl = inputWrapper.createEl("input", {
			type: "text",
			placeholder: "budget tag:#meeting near:ExactFile",
			cls: "graph-search-input prompt-input graph-search-input-raw",
		});

		this.statusEl = contentEl.createDiv({ cls: "graph-search-status" });
		this.resultsEl = contentEl.createDiv({
			cls: "graph-search-results prompt-results",
		});

		this.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.openSelectedResult();
				return;
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				this.moveSelection(1);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				this.moveSelection(-1);
				return;
			}
			if (event.key === "Escape") {
				this.close();
			}
			if (event.key === "Backspace") {
				if (this.handleBackspaceToken()) {
					event.preventDefault();
				}
			}
		});

		this.inputEl.addEventListener("input", (event) => {
			this.updateLayout();
			this.maybeSuggestNear(event);
			this.scheduleQuery();
			this.syncOverlayScroll();
		});

		this.updateLayout();
		this.inputEl.focus();
	}

		onClose() {
		if (this.debounceHandle) {
			window.clearTimeout(this.debounceHandle);
		}
		this.contentEl.empty();
	}

	private maybeSuggestNear(event: Event) {
		if (!this.inputEl || this.isSuggesting) {
			return;
		}
		if (!isColonInsert(event)) {
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
				this.updateLayout();
				this.scheduleQuery();
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
			this.results = [];
			this.selectedIndex = -1;
			this.lastCandidateCount = 0;
			this.lastNearTitles = [];
			this.renderResults([], 0, []);
			return;
		}

		try {
			if (!this.graphReady) {
				await this.plugin.buildGraphIndex();
				this.graphReady = true;
			}
			if (!this.searchReady) {
				await this.plugin.buildSearchIndex();
				this.searchReady = true;
			}
			const parsed = plugin.parse_query(rawQuery) as ParsedQuery;
			const candidates = (await plugin.search_candidates(
				parsed.base_query,
			)) as CandidateInput[];
			const scored = (await plugin.graph_rank_candidates(
				parsed.near_titles,
				candidates,
			)) as ScoredCandidate[];

			this.results = scored;
			this.selectedIndex = scored.length > 0 ? 0 : -1;
			this.lastCandidateCount = candidates.length;
			this.lastNearTitles = parsed.near_titles;
			this.lastSearchTerms = extractSearchTerms(parsed.base_query);
			this.renderResults(scored, candidates.length, parsed.near_titles);
		} catch (error) {
			console.error("Graph query failed", error);
			new Notice("Graph query failed; see console");
		}
	}

	private scheduleQuery() {
		if (this.debounceHandle) {
			window.clearTimeout(this.debounceHandle);
		}
		this.debounceHandle = window.setTimeout(() => {
			this.runQuery();
		}, 200);
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

		const list = this.resultsEl.createDiv();
		results.slice(0, 50).forEach((entry, index) => {
			const item = list.createDiv({ cls: "suggestion-item" });
			item.addClass("graph-search-result");
			if (index === this.selectedIndex) {
				item.addClass("is-selected");
			}
			const titleRow = item.createDiv({ cls: "graph-search-title" });
			titleRow.setText(entry.title);
			const pathRow = item.createDiv({ cls: "graph-search-path" });
			pathRow.setText(entry.path);

			const body = this.plugin.getSearchContent(entry.path);
			const snippet = buildSnippet(body, this.lastSearchTerms);
			if (snippet) {
				const snippetEl = item.createDiv({ cls: "graph-search-snippet" });
				snippetEl.innerHTML = snippet;
			}

			item.addEventListener("click", () => {
				this.selectedIndex = index;
				this.openSelectedResult();
			});
		});
		const selected = list.querySelector(".is-selected");
		if (selected instanceof HTMLElement) {
			selected.scrollIntoView({ block: "nearest" });
		}
	}

	private updateLayout() {
		if (!this.inputEl || !this.overlayEl) {
			return;
		}
		const raw = this.inputEl.value;
		try {
			this.layout = plugin.parse_query_layout(raw) as QueryLayout;
		} catch (error) {
			console.error("Failed to parse query layout", error);
			this.layout = { near_spans: [] };
		}
		this.overlayEl.innerHTML = buildOverlayHtml(
			raw,
			this.layout.near_spans,
			this.inputEl.placeholder,
		);
	}

	private handleBackspaceToken(): boolean {
		if (!this.inputEl) {
			return false;
		}
		const start = this.inputEl.selectionStart ?? 0;
		const end = this.inputEl.selectionEnd ?? 0;
		if (start !== end) {
			return false;
		}
		let span = findSpanAtCursor(this.layout.near_spans, start);
		const raw = this.inputEl.value;
		if (!span) {
			span = this.layout.near_spans.find(
				(candidate) =>
					start === candidate.end + 1 && raw[candidate.end] === '"',
			) ?? null;
		}
		if (!span) {
			return false;
		}
		const tokenRange = findNearTokenRange(raw, span);
		if (!tokenRange) {
			return false;
		}
		const updated = removeRange(raw, tokenRange.start, tokenRange.end);
		this.inputEl.value = updated.value;
		this.inputEl.setSelectionRange(updated.cursor, updated.cursor);
		this.updateLayout();
		this.scheduleQuery();
		return true;
	}

	private syncOverlayScroll() {
		if (!this.inputEl || !this.overlayEl) {
			return;
		}
		this.overlayEl.scrollLeft = this.inputEl.scrollLeft;
	}

	private moveSelection(delta: number) {
		if (this.results.length === 0) {
			return;
		}
		const maxIndex = this.results.length - 1;
		if (this.selectedIndex < 0) {
			this.selectedIndex = 0;
		} else {
			let next = this.selectedIndex + delta;
			if (next > maxIndex) {
				next = 0;
			} else if (next < 0) {
				next = maxIndex;
			}
			this.selectedIndex = next;
		}
		this.renderResults(
			this.results,
			this.lastCandidateCount,
			this.lastNearTitles,
		);
	}

	private openSelectedResult() {
		if (this.selectedIndex < 0 || this.selectedIndex >= this.results.length) {
			return;
		}
		const entry = this.results[this.selectedIndex];
		openFileByPath(this.app, entry.path);
		this.close();
	}
}

function openFileByPath(app: App, path: string) {
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		app.workspace.getLeaf().openFile(file);
	} else {
		new Notice(`File not found: ${path}`);
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
