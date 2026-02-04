import type { QueryAtom } from "../types";
import {
	buildRawFromAtoms,
	displayLengthForAtom,
	displayLengthForAtoms,
	normalizeAtoms,
	snapCaretBeforeChip,
} from "../query-utils";
import { QueryInputModel } from "../query-input/query-input-model";
import { buildEditableDomFromAtoms } from "../query-input/chip-dom";
import {
	getRangeOffsets,
	restoreCaretOffset,
} from "../query-input/editable-dom";

type InputControllerOptions = {
	inputEl: HTMLDivElement;
	onChange: (atoms: QueryAtom[], rawQuery: string) => void;
	onColonInsert?: (raw: string, caret: number) => void;
	onInputApplied?: () => void;
};

export class QueryInputController {
	private inputEl: HTMLDivElement;
	private inputModel = new QueryInputModel();
	private atoms: QueryAtom[] = [];
	private rawQuery = "";
	private isRendering = false;
	private onChange: InputControllerOptions["onChange"];
	private onColonInsert?: InputControllerOptions["onColonInsert"];
	private onInputApplied?: InputControllerOptions["onInputApplied"];

	constructor(options: InputControllerOptions) {
		this.inputEl = options.inputEl;
		this.onChange = options.onChange;
		this.onColonInsert = options.onColonInsert;
		this.onInputApplied = options.onInputApplied;
		this.bind();
		this.syncFromModel();
	}

	focus() {
		this.inputEl.focus();
	}

	insertChipAtCaret(
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
		this.syncFromModel();
	}

	private bind() {
		this.inputEl.addEventListener("beforeinput", (event) => {
			if (this.isRendering) {
				return;
			}
			if (!(event instanceof InputEvent)) {
				return;
			}
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
			this.onInputApplied?.();
			if (inputType === "insertText" && event.data === ":") {
				this.onColonInsert?.(
					this.inputModel.displayString(),
					this.inputModel.caretOffset,
				);
			}
			this.syncFromModel();
		});
	}

	private renderEditable(caretOffset?: number) {
		this.isRendering = true;
		this.inputEl.replaceChildren(buildEditableDomFromAtoms(this.atoms));
		const offset = caretOffset ?? this.displayLength(this.atoms);
		restoreCaretOffset(this.inputEl, offset, { preferBeforeChip: true });
		this.isRendering = false;
	}

	private syncFromModel() {
		this.atoms = normalizeAtoms(this.inputModel.atoms);
		this.rawQuery = buildRawFromAtoms(this.atoms);
		this.renderEditable(this.inputModel.caretOffset);
		this.onChange(this.atoms, this.rawQuery);
		this.inputEl.focus();
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
		this.inputModel.applyBackspace();
		return true;
	}
}
