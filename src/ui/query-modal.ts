import { App, Modal, Notice, TFile } from "obsidian";

import * as wasm from "../../pkg/obsidian_rust_plugin";

import type {
	CandidateInput,
	ParsedQuery,
	ScoredCandidate,
	ScoreWeights,
} from "./types";
import type { ChipSpan } from "./query-utils";
import {
	buildEditableHtml,
	buildSnippet,
	extractBodyTerms,
	extractRawFromEditable,
	findTokenRange,
	findSpanAtCursor,
	findTokenAtCursor,
	formatNearValue,
	formatTagValue,
	getCaretOffset,
	isColonInsert,
	removeRange,
	restoreCaretOffset,
} from "./query-utils";
import { openTitlePicker } from "./title-suggest";
import { openTagPicker } from "./tag-suggest";

export type QueryLayout = {
	spans: ChipSpan[];
};

type GraphSearchPluginApi = {
	buildGraphIndex(): Promise<unknown>;
	buildSearchIndex(): Promise<unknown>;
	getSearchContent(path: string): string;
	getScoreWeights(): ScoreWeights;
	isDebugMode(): boolean;
};

export class GraphQueryModal extends Modal {
	private plugin: GraphSearchPluginApi;
	private inputEl?: HTMLDivElement;
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
	private layout: QueryLayout = { spans: [] };
	private rawQuery = "";
	private isRendering = false;

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
		this.inputEl = inputWrapper.createDiv({
			cls: "graph-search-input prompt-input graph-search-input-raw",
		});
		this.inputEl.setAttribute("contenteditable", "true");
		this.inputEl.setAttribute("spellcheck", "false");
		this.inputEl.setAttribute(
			"data-placeholder",
			"budget tag:#meeting near:ExactFile",
		);

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
			if (this.isRendering) {
				return;
			}
			const raw = extractRawFromEditable(this.inputEl as HTMLElement);
			const caret = getCaretOffset(this.inputEl as HTMLElement) ?? raw.length;
			this.rawQuery = raw;
			this.updateLayout();
			this.renderEditable(caret);
			this.maybeSuggestChip(event, raw, caret);
			this.scheduleQuery();
		});

		this.updateLayout();
		this.renderEditable(0);
		this.inputEl.focus();
	}

	onClose() {
		if (this.debounceHandle) {
			window.clearTimeout(this.debounceHandle);
		}
		this.contentEl.empty();
	}

	private maybeSuggestChip(event: Event, raw: string, cursor: number) {
		if (!this.inputEl || this.isSuggesting) {
			return;
		}
		if (!isColonInsert(event)) {
			return;
		}
		const tokenInfo = findTokenAtCursor(raw, cursor);
		if (!tokenInfo) {
			return;
		}
		if (tokenInfo.token.startsWith("near:")) {
			const afterPrefix = tokenInfo.token.slice(5);
			if (afterPrefix.length > 0) {
				return;
			}
			this.isSuggesting = true;
			openTitlePicker(
				this.app,
				(selected) => {
					const formatted = formatNearValue(selected);
					this.insertChipValue(raw, tokenInfo, "near:", formatted);
				},
				() => {
					this.isSuggesting = false;
				},
			);
			return;
		}
		if (tokenInfo.token.startsWith("tag:")) {
			const afterPrefix = tokenInfo.token.slice(4);
			if (afterPrefix.length > 0) {
				return;
			}
			this.isSuggesting = true;
			openTagPicker(
				this.app,
				(selected) => {
					const formatted = formatTagValue(selected);
					this.insertChipValue(raw, tokenInfo, "tag:", formatted);
				},
				() => {
					this.isSuggesting = false;
				},
			);
		}
	}

	private async runQuery() {
		if (!this.resultsEl || !this.statusEl) {
			return;
		}
		const rawQuery = this.rawQuery.trim();
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
				this.plugin.getScoreWeights(),
			)) as ScoredCandidate[];

			this.results = scored;
			this.selectedIndex = scored.length > 0 ? 0 : -1;
			this.lastCandidateCount = candidates.length;
			this.lastNearTitles = parsed.near_titles;
			this.lastSearchTerms = extractBodyTerms(parsed.base_query);
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
		const showDebug = this.plugin.isDebugMode();
		if (showDebug) {
			this.statusEl.setText(
				`Candidates: ${candidateCount}, Near: ${nearTitles.length}, Results: ${results.length}`,
			);
			this.statusEl.show();
		} else {
			this.statusEl.setText("");
			this.statusEl.hide();
		}

		if (results.length === 0) {
			this.resultsEl.createEl("div", { text: "No results." });
			return;
		}

		const list = this.resultsEl.createDiv();
		const weights = showDebug ? this.plugin.getScoreWeights() : null;
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
				if (showDebug && weights) {
					const weightedDistance = entry.distance_score * weights.distance_weight;
					const weightedTitle = entry.title_score * weights.title_weight;
					const weightedBody = entry.body_score * weights.body_weight;
					const debugRow = item.createDiv({ cls: "graph-search-snippet" });
					debugRow.setText(
						`distance ${entry.distance_score.toFixed(2)} (${weightedDistance.toFixed(2)}), title ${entry.title_score.toFixed(2)} (${weightedTitle.toFixed(2)}), body ${entry.body_score.toFixed(2)} (${weightedBody.toFixed(2)}), total ${entry.total_score.toFixed(2)}`,
					);
				}
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
		const raw = this.rawQuery;
		try {
			this.layout = wasm.parse_query_layout(raw) as QueryLayout;
		} catch (error) {
			console.error("Failed to parse query layout", error);
			this.layout = { spans: [] };
		}
	}

	private renderEditable(caretOffset?: number) {
		if (!this.inputEl) {
			return;
		}
		this.isRendering = true;
		this.inputEl.innerHTML = buildEditableHtml(
			this.rawQuery,
			this.layout.spans,
		);
		const offset = caretOffset ?? this.rawQuery.length;
		restoreCaretOffset(this.inputEl, offset);
		this.isRendering = false;
	}

	private setRawQuery(raw: string, caretOffset?: number) {
		this.rawQuery = raw;
		this.updateLayout();
		this.renderEditable(caretOffset);
		this.scheduleQuery();
		this.inputEl?.focus();
	}

	private insertChipValue(
		raw: string,
		tokenInfo: { start: number; end: number; token: string },
		prefix: string,
		value: string,
	) {
		const before = raw.slice(0, tokenInfo.start);
		const after = raw.slice(tokenInfo.end);
		const needsSpace = after.length === 0 || after[0] !== " ";
		const replacement = `${prefix}${value}${needsSpace ? " " : ""}`;
		const nextRaw = `${before}${replacement}${after}`;
		const newCursor = before.length + replacement.length;
		this.isSuggesting = false;
		this.setRawQuery(nextRaw, newCursor);
	}

	private handleBackspaceToken(): boolean {
		if (!this.inputEl) {
			return false;
		}
		const selection = window.getSelection();
		if (selection && !selection.isCollapsed) {
			return false;
		}
		const start = getCaretOffset(this.inputEl) ?? 0;
		let span = findSpanAtCursor(this.layout.spans, start);
		const raw = this.rawQuery;
		if (!span) {
			span =
				this.layout.spans.find(
					(candidate) =>
						start === candidate.end + 1 &&
						raw[candidate.end] === '"',
				) ?? null;
		}
		if (!span) {
			return false;
		}
		const tokenRange = findTokenRange(raw, span);
		if (!tokenRange) {
			return false;
		}
		const updated = removeRange(raw, tokenRange.start, tokenRange.end);
		this.setRawQuery(updated.value, updated.cursor);
		return true;
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
