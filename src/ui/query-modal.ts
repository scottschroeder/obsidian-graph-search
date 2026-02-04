import { App, Modal, Notice, TFile } from "obsidian";

import * as wasm from "../../pkg/obsidian_rust_plugin";

import type { GraphQueryResult, QueryAtom, ScoredCandidate } from "./types";
import { extractBodyTermsFromAtoms } from "./query-utils";
import { QueryInputController } from "./query-modal/input-controller";
import { GraphResultsRenderer } from "./query-modal/results-renderer";
import { QuerySuggestController } from "./query-modal/suggest-controller";
import type { GraphSearchPluginApi } from "./query-modal/plugin-api";

export class GraphQueryModal extends Modal {
	private static readonly DEBOUNCE_MS = 20;
	private static readonly MAX_RESULTS = 50;

	private plugin: GraphSearchPluginApi;
	private inputEl?: HTMLDivElement;
	private resultsEl?: HTMLDivElement;
	private statusEl?: HTMLDivElement;
	private results: ScoredCandidate[] = [];
	private selectedIndex = -1;
	private debounceHandle?: number;
	private graphReady = false;
	private searchReady = false;
	private buildPromise?: Promise<void>;
	private isClosed = false;
	private lastCandidateCount = 0;
	private lastNearTitles: string[] = [];
	private lastSearchTerms: string[] = [];
	private atoms: QueryAtom[] = [];
	private rawQuery = "";
	private pendingFilterHandle?: number;
	private pendingFilterCaret?: number;
	private inputController?: QueryInputController;
	private suggestController?: QuerySuggestController;
	private resultsRenderer?: GraphResultsRenderer;

	constructor(app: App, plugin: GraphSearchPluginApi) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("prompt");
		this.isClosed = false;
		this.graphReady = false;
		this.searchReady = false;
		this.startBuild();

		const inputWrapper = contentEl.createDiv({
			cls: "graph-search-input-wrapper",
		});
		this.inputEl = inputWrapper.createDiv({
			cls: "graph-search-input prompt-input graph-search-input-raw",
		});
		this.inputEl.setAttribute("contenteditable", "true");
		this.inputEl.setAttribute("spellcheck", "false");
		this.inputEl.setAttribute("data-placeholder", "");

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
		});

		this.inputController = new QueryInputController({
			inputEl: this.inputEl,
			onChange: (atoms, raw) => {
				this.atoms = atoms;
				this.rawQuery = raw;
				this.scheduleQuery();
			},
			onInputApplied: () => {
				this.cancelPendingFilter();
			},
			onColonInsert: (raw, caret) => {
				this.maybeScheduleFilter(raw, caret);
			},
			isDebug: () => this.plugin.isDebugMode(),
		});

		this.suggestController = new QuerySuggestController(
			this.app,
			this.plugin,
			(kind, value, caret, display) => {
				this.inputController?.insertChipAtCaret(
					kind,
					value,
					caret,
					display,
				);
			},
		);

		if (this.resultsEl && this.statusEl) {
			this.resultsRenderer = new GraphResultsRenderer({
				resultsEl: this.resultsEl as unknown as HTMLElement & {
					empty(): void;
					setText(text: string): void;
					show(): void;
					hide(): void;
					createEl(
						tag: string,
						options?: { text?: string; cls?: string },
					): HTMLElement;
					createDiv(options?: {
						cls?: string;
						text?: string;
					}): HTMLDivElement;
				},
				statusEl: this.statusEl as unknown as HTMLElement & {
					empty(): void;
					setText(text: string): void;
					show(): void;
					hide(): void;
					createEl(
						tag: string,
						options?: { text?: string; cls?: string },
					): HTMLElement;
					createDiv(options?: {
						cls?: string;
						text?: string;
					}): HTMLDivElement;
				},
				plugin: this.plugin,
				maxResults: GraphQueryModal.MAX_RESULTS,
				onSelectIndex: (index) => {
					this.selectedIndex = index;
					this.openSelectedResult();
				},
			});
		}

		this.inputController.focus();
	}

	onClose() {
		if (this.debounceHandle) {
			window.clearTimeout(this.debounceHandle);
		}
		this.cancelPendingFilter();
		this.isClosed = true;
		this.plugin.clearIndexes();
		this.plugin.clearActiveModal();
		this.contentEl.empty();
	}

	focusInput() {
		this.inputController?.focus();
	}

	private startBuild() {
		if (this.buildPromise) {
			return;
		}
		this.buildPromise = (async () => {
			try {
				await this.plugin.buildGraphIndex();
				if (this.isClosed) {
					return;
				}
				this.graphReady = true;
				await this.plugin.buildSearchIndex();
				if (this.isClosed) {
					return;
				}
				this.searchReady = true;
			} catch (error) {
				console.error("Graph index build failed", error);
				new Notice("Graph index build failed; see console");
			} finally {
				if (this.isClosed) {
					this.plugin.clearIndexes();
				}
			}
		})();
		this.buildPromise.finally(() => {
			this.buildPromise = undefined;
		});
	}

	private maybeScheduleFilter(raw: string, cursor: number) {
		if (this.suggestController?.suggesting) {
			return;
		}
		const insertIndex = cursor - 1;
		if (insertIndex < 0) {
			return;
		}
		const before = insertIndex - 1;
		if (before >= 0 && !/\s/.test(raw[before])) {
			return;
		}
		this.pendingFilterCaret = cursor;
		this.pendingFilterHandle = window.setTimeout(() => {
			this.openFilterSuggest();
		}, 150);
	}

	private openFilterSuggest() {
		if (this.pendingFilterCaret === undefined) {
			return;
		}
		const caret = this.pendingFilterCaret;
		this.pendingFilterCaret = undefined;
		this.pendingFilterHandle = undefined;
		this.suggestController?.openFilterSuggest(caret);
	}

	private async runQuery() {
		if (!this.resultsEl || !this.statusEl) {
			return;
		}
		const hasTokens = this.atoms.some(
			(atom) =>
				atom.kind !== "whitespace" && atom.value.trim().length > 0,
		);
		if (!hasTokens) {
			this.results = [];
			this.selectedIndex = -1;
			this.lastCandidateCount = 0;
			this.lastNearTitles = [];
			this.renderResults([], 0, []);
			return;
		}

		try {
			if (this.buildPromise) {
				await this.buildPromise;
			}
			if (!this.graphReady) {
				await this.plugin.buildGraphIndex();
				this.graphReady = true;
			}
			if (!this.searchReady) {
				await this.plugin.buildSearchIndex();
				this.searchReady = true;
			}
			const response = (await wasm.graph_query_from_atoms(
				this.atoms,
				this.plugin.getScoreWeights(),
			)) as GraphQueryResult;
			const scored = response.results as ScoredCandidate[];

			this.results = scored;
			this.selectedIndex = scored.length > 0 ? 0 : -1;
			this.lastCandidateCount = response.candidate_count;
			this.lastNearTitles = response.near_titles;
			this.lastSearchTerms = extractBodyTermsFromAtoms(this.atoms);
			this.renderResults(
				scored,
				response.candidate_count,
				response.near_titles,
			);
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
		}, GraphQueryModal.DEBOUNCE_MS);
	}

	private renderResults(
		results: ScoredCandidate[],
		candidateCount: number,
		nearTitles: string[],
	) {
		this.resultsRenderer?.render(
			results,
			candidateCount,
			nearTitles,
			this.selectedIndex,
			this.lastSearchTerms,
		);
	}

	private cancelPendingFilter() {
		if (this.pendingFilterHandle) {
			window.clearTimeout(this.pendingFilterHandle);
			this.pendingFilterHandle = undefined;
		}
		this.pendingFilterCaret = undefined;
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
		if (
			this.selectedIndex < 0 ||
			this.selectedIndex >= this.results.length
		) {
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
