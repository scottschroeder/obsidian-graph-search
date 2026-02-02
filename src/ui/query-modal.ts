import { App, Modal, Notice, TFile } from "obsidian";

import * as wasm from "../../pkg/obsidian_rust_plugin";

import type {
	GraphQueryResult,
	QueryAtom,
	ScoredCandidate,
	ScoreWeights,
} from "./types";
import {
	buildRawFromAtoms,
	displayLengthForAtom,
	displayLengthForAtoms,
	extractBodyTermsFromAtoms,
	formatTagValue,
	isColonInsert,
	normalizeAtoms,
	snapCaretBeforeChip,
} from "./query-utils";
import { QueryInputModel } from "./query-input/query-input-model";
import { buildSnippet } from "./html-utils";
import { buildEditableHtmlFromAtoms } from "./query-input/html-utils";
import {
	extractRawFromEditable,
	getCaretOffset,
	getRangeOffsets,
	restoreCaretOffset,
} from "./query-input/editable-dom";
import { openFilterPicker } from "./filter-suggest";
import { openPathPicker } from "./path-suggest";
import { openTitlePicker } from "./title-suggest";
import { openTagPicker } from "./tag-suggest";

type GraphSearchPluginApi = {
	buildGraphIndex(): Promise<void>;
	buildSearchIndex(): Promise<void>;
	getSearchContent(path: string): string;
	getDisplayTitle(path: string): string;
	getScoreWeights(): ScoreWeights;
	isDebugMode(): boolean;
};

export class GraphQueryModal extends Modal {
	private static readonly DEBOUNCE_MS = 200;
	private static readonly MAX_RESULTS = 50;

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
	private atoms: QueryAtom[] = [];
	private rawQuery = "";
	private isRendering = false;
	private pendingFilterHandle?: number;
	private pendingFilterCaret?: number;
	private inputModel = new QueryInputModel();

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

		this.inputEl.addEventListener("beforeinput", (event) => {
			if (this.isRendering) {
				return;
			}
			if (!(event instanceof InputEvent)) {
				return;
			}
			this.logCaretContext("beforeinput:start", event);
			const selection = window.getSelection();
			const range = selection?.rangeCount
				? selection.getRangeAt(0)
				: null;
			const offsets =
				range && this.inputEl
					? getRangeOffsets(this.inputEl, range)
					: null;
			if (!offsets) {
				return;
			}
			const inputType = event.inputType ?? "";
			const rangeStart = Math.min(offsets.start, offsets.end);
			const rangeEnd = Math.max(offsets.start, offsets.end);
			const snappedCaret = snapCaretBeforeChip(
				this.inputModel.atoms,
				rangeStart,
			);
			this.inputModel.setCaret(snappedCaret);
			let handled = false;
			if (inputType === "insertText") {
				const data = event.data ?? "";
				if (rangeEnd > rangeStart) {
					this.inputModel.applyReplaceRange(
						rangeStart,
						rangeEnd,
						data,
					);
				} else {
					this.inputModel.applyInsertText(data);
				}
				handled = true;
				if (data === ":") {
					if (this.handleLiteralColonFromModel()) {
						event.preventDefault();
						this.syncFromModel();
						return;
					}
				}
			} else if (inputType === "insertFromPaste") {
				const data =
					event.dataTransfer?.getData("text/plain") ??
					event.data ??
					"";
				if (rangeEnd > rangeStart) {
					this.inputModel.applyReplaceRange(
						rangeStart,
						rangeEnd,
						data,
					);
				} else {
					this.inputModel.applyInsertText(data);
				}
				handled = true;
			} else if (inputType === "deleteContentBackward") {
				if (rangeEnd > rangeStart) {
					this.inputModel.deleteRange(rangeStart, rangeEnd);
				} else {
					this.inputModel.applyBackspace();
				}
				handled = true;
			} else if (inputType === "deleteContentForward") {
				if (rangeEnd > rangeStart) {
					this.inputModel.deleteRange(rangeStart, rangeEnd);
				} else {
					this.inputModel.applyDeleteForward();
				}
				handled = true;
			}
			if (!handled) {
				return;
			}
			event.preventDefault();
			this.cancelPendingFilter();
			if (inputType === "insertText" && event.data === ":") {
				this.maybeScheduleFilter(
					event,
					this.inputModel.displayString(),
					this.inputModel.caretOffset,
				);
			}
			this.syncFromModel();
			this.logCaretContext("beforeinput:end", event);
		});

		this.syncFromModel();
		this.inputEl.focus();
	}

	onClose() {
		if (this.debounceHandle) {
			window.clearTimeout(this.debounceHandle);
		}
		this.cancelPendingFilter();
		this.contentEl.empty();
	}

	private maybeScheduleFilter(event: Event, raw: string, cursor: number) {
		if (this.isSuggesting) {
			return;
		}
		if (!isColonInsert(event)) {
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
		if (this.pendingFilterCaret === undefined || this.isSuggesting) {
			return;
		}
		const caret = this.pendingFilterCaret;
		this.pendingFilterCaret = undefined;
		this.pendingFilterHandle = undefined;
		this.isSuggesting = true;
		openFilterPicker(
			this.app,
			(selected) => {
				this.isSuggesting = false;
				if (selected === "literal") {
					return;
				}
				if (selected === "near-current") {
					const activeFile = this.app.workspace.getActiveFile();
					if (activeFile) {
						const display = this.plugin.getDisplayTitle(
							activeFile.path,
						);
						this.insertChipAtCaret(
							"near",
							activeFile.path,
							caret,
							display,
						);
					}
					return;
				}
				if (selected === "near") {
					this.isSuggesting = true;
					openTitlePicker(
						this.app,
						(path, display) => {
							this.insertChipAtCaret(
								"near",
								path,
								caret,
								display,
							);
						},
						() => {
							this.isSuggesting = false;
						},
					);
					return;
				}
				if (selected === "tag") {
					this.isSuggesting = true;
					openTagPicker(
						this.app,
						(value) => {
							const formatted = formatTagValue(value);
							this.insertChipAtCaret("tag", formatted, caret);
						},
						() => {
							this.isSuggesting = false;
						},
					);
					return;
				}
				if (selected === "path") {
					this.isSuggesting = true;
					openPathPicker(
						this.app,
						(value) => {
							this.insertChipAtCaret("path", value, caret);
						},
						() => {
							this.isSuggesting = false;
						},
					);
				}
			},
			() => {
				this.isSuggesting = false;
			},
		);
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
		results
			.slice(0, GraphQueryModal.MAX_RESULTS)
			.forEach((entry, index) => {
				const item = list.createDiv({ cls: "suggestion-item" });
				item.addClass("graph-search-result");
				if (index === this.selectedIndex) {
					item.addClass("is-selected");
				}
				const titleRow = item.createDiv({ cls: "graph-search-title" });
				titleRow.setText(this.plugin.getDisplayTitle(entry.path));
				const pathRow = item.createDiv({ cls: "graph-search-path" });
				pathRow.setText(entry.path);

				const body = this.plugin.getSearchContent(entry.path);
				const snippet = buildSnippet(body, this.lastSearchTerms);
				if (snippet) {
					const snippetEl = item.createDiv({
						cls: "graph-search-snippet",
					});
					// innerHTML is used here for performance with highlighted snippets.
					// XSS is prevented by escapeHtml() in buildSnippet() which sanitizes
					// all content before highlight spans are inserted.
					// See: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Avoid+%60innerHTML%60%2C+%60outerHTML%60+and+%60insertAdjacentHTML%60
					snippetEl.innerHTML = snippet;
				}
				if (showDebug && weights) {
					const weightedDistance =
						entry.distance_score * weights.distance_weight;
					const weightedTitle =
						entry.title_score * weights.title_weight;
					const weightedBody = entry.body_score * weights.body_weight;
					const debugRow = item.createDiv({
						cls: "graph-search-snippet",
					});
					debugRow.setText(
						`distance ${entry.distance_score.toFixed(2)} (${weightedDistance.toFixed(2)}), title ${entry.title_score.toFixed(2)} (${weightedTitle.toFixed(2)}), body ${entry.body_score.toFixed(2)} (${weightedBody.toFixed(2)}), total ${entry.total_score.toFixed(2)}`,
					);
				}

				// Add match quality badge
				const scoreBadge = item.createDiv({
					cls: "graph-search-score-badge",
				});
				scoreBadge.setText(entry.total_score.toFixed(2));

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

	private renderEditable(caretOffset?: number) {
		if (!this.inputEl) {
			return;
		}
		this.isRendering = true;
		// innerHTML is required for the contenteditable chip system where we need to
		// preserve caret position across re-renders. Migration to DOM APIs would break
		// caret positioning. XSS is prevented by escapeHtml() in buildEditableHtmlFromAtoms()
		// which sanitizes all user input before insertion.
		this.inputEl.innerHTML = buildEditableHtmlFromAtoms(this.atoms);
		const offset = caretOffset ?? this.displayLength(this.atoms);
		restoreCaretOffset(this.inputEl, offset, { preferBeforeChip: true });
		this.isRendering = false;
		this.logCaretContext("render", undefined);
	}

	private syncFromModel() {
		this.atoms = normalizeAtoms(this.inputModel.atoms);
		this.rawQuery = buildRawFromAtoms(this.atoms);
		this.renderEditable(this.inputModel.caretOffset);
		this.scheduleQuery();
		this.inputEl?.focus();
	}

	private insertChipAtCaret(
		kind: QueryAtom["kind"],
		value: string,
		caretOffset: number,
		display?: string,
	) {
		const cleanedValue = value.trim();
		const removal = this.removeColonAtOffset(
			this.inputModel.atoms,
			caretOffset - 1,
		);
		const adjustedOffset = removal.removed
			? Math.max(0, caretOffset - 1)
			: caretOffset;
		this.inputModel = new QueryInputModel(removal.atoms, adjustedOffset);
		this.inputModel.insertChip(kind, cleanedValue, display);
		this.isSuggesting = false;
		this.syncFromModel();
	}

	private removeColonAtOffset(
		atoms: QueryAtom[],
		offset: number,
	): { atoms: QueryAtom[]; removed: boolean } {
		if (offset < 0) {
			return { atoms, removed: false };
		}
		const updated = [...atoms];
		let cursor = 0;
		for (let index = 0; index < updated.length; index += 1) {
			const current = updated[index];
			const length = displayLengthForAtom(current);
			if (offset >= cursor && offset < cursor + length) {
				if (current.kind !== "term") {
					return { atoms: updated, removed: false };
				}
				const relative = offset - cursor;
				if (current.value[relative] !== ":") {
					return { atoms: updated, removed: false };
				}
				const nextValue =
					current.value.slice(0, relative) +
					current.value.slice(relative + 1);
				if (nextValue.trim().length === 0) {
					updated.splice(index, 1);
				} else {
					updated[index] = { kind: "term", value: nextValue };
				}
				return { atoms: updated, removed: true };
			}
			cursor += length;
		}
		return { atoms: updated, removed: false };
	}

	private displayLength(atoms: QueryAtom[]): number {
		return displayLengthForAtoms(atoms);
	}

	private cancelPendingFilter() {
		if (this.pendingFilterHandle) {
			window.clearTimeout(this.pendingFilterHandle);
			this.pendingFilterHandle = undefined;
		}
		this.pendingFilterCaret = undefined;
	}

	private handleLiteralColonFromModel(): boolean {
		const raw = this.inputModel.displayString();
		const cursor = this.inputModel.caretOffset;
		const insertIndex = cursor - 1;
		const firstIndex = insertIndex - 1;
		if (insertIndex < 0 || firstIndex < 0) {
			return false;
		}
		if (raw[firstIndex] !== ":") {
			return false;
		}
		const beforeFirst = firstIndex - 1;
		if (beforeFirst >= 0 && !/\s/.test(raw[beforeFirst])) {
			return false;
		}
		this.cancelPendingFilter();
		this.inputModel.applyBackspace();
		return true;
	}

	private logCaretContext(reason: string, event?: InputEvent) {
		if (!this.plugin.isDebugMode()) {
			return;
		}
		if (!this.inputEl) {
			return;
		}
		const selection = window.getSelection();
		const anchorNode = selection?.anchorNode ?? null;
		const focusNode = selection?.focusNode ?? null;
		const anchorOffset = selection?.anchorOffset ?? null;
		const focusOffset = selection?.focusOffset ?? null;
		const raw = extractRawFromEditable(this.inputEl);
		const caret = getCaretOffset(this.inputEl);
		const atomSummary = this.atoms.map((atom) => atom.kind).join(",");
		const inputType = event?.inputType ?? "";
		const data = event?.data ?? "";
		console.log("[graph-search] caret", {
			reason,
			inputType,
			data,
			raw,
			caret,
			modelCaret: this.inputModel.caretOffset,
			atoms: atomSummary,
			anchorNode,
			anchorOffset,
			focusNode,
			focusOffset,
		});
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
