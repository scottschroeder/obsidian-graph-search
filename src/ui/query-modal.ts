import { App, Modal, Notice, TFile } from "obsidian";

import * as wasm from "../../pkg/obsidian_rust_plugin";

import type {
	CandidateInput,
	ParsedQuery,
	QueryAtom,
	ScoredCandidate,
	ScoreWeights,
} from "./types";
import {
	buildEditableHtmlFromAtoms,
	buildSnippet,
	buildRawFromAtoms,
	extractBodyTerms,
	extractAtomsFromEditable,
	extractRawFromEditable,
	formatNearValue,
	formatTagValue,
	getCaretOffset,
	isColonInsert,
	normalizeAtoms,
	restoreCaretOffset,
} from "./query-utils";
import { openFilterPicker } from "./filter-suggest";
import { openPathPicker } from "./path-suggest";
import { openTitlePicker } from "./title-suggest";
import { openTagPicker } from "./tag-suggest";

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
	private atoms: QueryAtom[] = [];
	private rawQuery = "";
	private isRendering = false;
	private pendingFilterHandle?: number;
	private pendingFilterCaret?: number;

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
			const caret =
				getCaretOffset(this.inputEl as HTMLElement) ?? raw.length;
			const atoms = extractAtomsFromEditable(this.inputEl as HTMLElement);
			if (this.handleLiteralColon(event, raw, caret, atoms)) {
				return;
			}
			this.cancelPendingFilter();
			this.maybeScheduleFilter(event, raw, caret);
			this.setAtoms(atoms, caret);
		});

		this.setAtoms([], 0);
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
						this.insertChipAtCaret(
							"near",
							activeFile.basename,
							caret,
						);
					}
					return;
				}
				if (selected === "near") {
					this.isSuggesting = true;
					openTitlePicker(
						this.app,
						(value) => {
							const formatted = formatNearValue(value);
							this.insertChipAtCaret("near", formatted, caret);
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
			const parsed = wasm.parse_query_atoms(this.atoms) as ParsedQuery;
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
				const snippetEl = item.createDiv({
					cls: "graph-search-snippet",
				});
				snippetEl.innerHTML = snippet;
			}
			if (showDebug && weights) {
				const weightedDistance =
					entry.distance_score * weights.distance_weight;
				const weightedTitle = entry.title_score * weights.title_weight;
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
		this.inputEl.innerHTML = buildEditableHtmlFromAtoms(this.atoms);
		const offset = caretOffset ?? this.displayLength(this.atoms);
		restoreCaretOffset(this.inputEl, offset);
		this.isRendering = false;
	}

	private setAtoms(atoms: QueryAtom[], caretOffset?: number) {
		this.atoms = normalizeAtoms(atoms);
		this.rawQuery = buildRawFromAtoms(this.atoms);
		this.renderEditable(caretOffset);
		this.scheduleQuery();
		this.inputEl?.focus();
	}

	private insertChipAtCaret(
		kind: QueryAtom["kind"],
		value: string,
		caretOffset: number,
	) {
		const cleanedValue = value.trim();
		const removal = this.removeColonAtOffset(this.atoms, caretOffset - 1);
		const adjustedOffset = removal.removed
			? Math.max(0, caretOffset - 1)
			: caretOffset;
		const result = this.insertAtomAtOffset(
			removal.atoms,
			{ kind, value: cleanedValue },
			adjustedOffset,
		);
		const updated = [...result.atoms];
		const next = updated[result.index + 1];
		if (!next || next.kind !== "whitespace") {
			updated.splice(result.index + 1, 0, {
				kind: "whitespace",
				value: " ",
			});
			result.caretOffset += 1;
		}
		this.isSuggesting = false;
		this.setAtoms(updated, result.caretOffset);
	}

	private insertAtomAtOffset(
		atoms: QueryAtom[],
		atom: QueryAtom,
		offset: number,
	): { atoms: QueryAtom[]; caretOffset: number; index: number } {
		const updated = [...atoms];
		let cursor = 0;
		for (let index = 0; index < updated.length; index += 1) {
			const current = updated[index];
			const length = current.value.length;
			const end = cursor + length;
			if (offset <= end) {
				if (current.kind === "term") {
					const relative = Math.max(0, offset - cursor);
					if (relative <= 0) {
						updated.splice(index, 0, atom);
						return {
							atoms: updated,
							caretOffset:
								this.offsetForAtom(updated, index) +
								atom.value.length,
							index,
						};
					}
					if (relative >= length) {
						updated.splice(index + 1, 0, atom);
						return {
							atoms: updated,
							caretOffset:
								this.offsetForAtom(updated, index + 1) +
								atom.value.length,
							index: index + 1,
						};
					}
					const before = current.value.slice(0, relative).trim();
					const after = current.value.slice(relative).trim();
					const insertIndex = index + (before ? 1 : 0);
					const replacement: QueryAtom[] = [];
					if (before) {
						replacement.push({ kind: "term", value: before });
					}
					replacement.push(atom);
					if (after) {
						replacement.push({ kind: "term", value: after });
					}
					updated.splice(index, 1, ...replacement);
					return {
						atoms: updated,
						caretOffset:
							this.offsetForAtom(updated, insertIndex) +
							atom.value.length,
						index: insertIndex,
					};
				}
				const insertIndex = offset <= cursor ? index : index + 1;
				updated.splice(insertIndex, 0, atom);
				return {
					atoms: updated,
					caretOffset:
						this.offsetForAtom(updated, insertIndex) +
						atom.value.length,
					index: insertIndex,
				};
			}
			cursor = end;
		}
		updated.push(atom);
		return {
			atoms: updated,
			caretOffset:
				this.offsetForAtom(updated, updated.length - 1) +
				atom.value.length,
			index: updated.length - 1,
		};
	}

	private offsetForAtom(atoms: QueryAtom[], index: number): number {
		let offset = 0;
		for (let i = 0; i < atoms.length; i += 1) {
			if (i === index) {
				return offset;
			}
			offset += atoms[i].value.length;
		}
		return offset;
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
			const length = current.value.length;
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
		return atoms.reduce((total, atom) => total + atom.value.length, 0);
	}

	private cancelPendingFilter() {
		if (this.pendingFilterHandle) {
			window.clearTimeout(this.pendingFilterHandle);
			this.pendingFilterHandle = undefined;
		}
		this.pendingFilterCaret = undefined;
	}

	private handleLiteralColon(
		event: Event,
		raw: string,
		cursor: number,
		atoms: QueryAtom[],
	): boolean {
		if (!isColonInsert(event)) {
			return false;
		}
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
		const removal = this.removeColonAtOffset(atoms, cursor - 1);
		const nextCursor = removal.removed ? Math.max(0, cursor - 1) : cursor;
		this.setAtoms(removal.atoms, nextCursor);
		return true;
	}

	private handleBackspaceToken(): boolean {
		if (!this.inputEl) {
			return false;
		}
		const selection = window.getSelection();
		if (selection && !selection.isCollapsed) {
			return false;
		}
		const range = selection?.getRangeAt(0);
		if (!range) {
			return false;
		}
		const startOffset = getCaretOffset(this.inputEl) ?? 0;
		let chipEl: HTMLElement | null = null;
		const container = range.startContainer;
		if (container.nodeType === Node.ELEMENT_NODE) {
			chipEl = (container as HTMLElement).closest(".graph-search-chip");
		} else {
			chipEl =
				container.parentElement?.closest(".graph-search-chip") ?? null;
		}
		if (!chipEl && container.nodeType === Node.TEXT_NODE) {
			if (range.startOffset === 0) {
				const prev = container.previousSibling;
				if (prev instanceof HTMLElement) {
					chipEl = prev.classList.contains("graph-search-chip")
						? prev
						: null;
				}
			}
		}
		if (!chipEl) {
			return false;
		}
		chipEl.remove();
		const atoms = extractAtomsFromEditable(this.inputEl as HTMLElement);
		const nextOffset = Math.max(0, startOffset - 1);
		this.setAtoms(atoms, nextOffset);
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
