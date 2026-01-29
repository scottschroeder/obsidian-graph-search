import { App, Modal, Notice, TFile } from "obsidian";

import * as wasm from "../../pkg/obsidian_rust_plugin";

import type {
	CandidateInput,
	ParsedQuery,
	ScoredCandidate,
} from "./types";
import type { NearSpan } from "./query-utils";
import {
	buildOverlayHtml,
	buildSnippet,
	extractSearchTerms,
	findNearTokenRange,
	findSpanAtCursor,
	findTokenAtCursor,
	formatNearValue,
	isColonInsert,
	removeRange,
} from "./query-utils";
import { openTitlePicker } from "./title-suggest";

export type QueryLayout = {
	near_spans: NearSpan[];
};

type GraphSearchPluginApi = {
	buildGraphIndex(): Promise<unknown>;
	buildSearchIndex(): Promise<unknown>;
	getSearchContent(path: string): string;
};

export class GraphQueryModal extends Modal {
	private plugin: GraphSearchPluginApi;
	private inputEl?: HTMLInputElement;
	private resultsEl?: HTMLDivElement;
	private statusEl?: HTMLDivElement;
	private overlayEl?: HTMLDivElement;
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

	constructor(app: App, plugin: GraphSearchPluginApi) {
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
			const parsed = wasm.parse_query(rawQuery) as ParsedQuery;
			const candidates = (await wasm.search_candidates(
				parsed.base_query,
			)) as CandidateInput[];
			const scored = (await wasm.graph_rank_candidates(
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
			this.layout = wasm.parse_query_layout(raw) as QueryLayout;
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
			span =
				this.layout.near_spans.find(
					(candidate) =>
						start === candidate.end + 1 &&
						raw[candidate.end] === '"',
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
