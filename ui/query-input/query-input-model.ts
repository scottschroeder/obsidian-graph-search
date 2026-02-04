import type { QueryAtom } from "../types";
import {
	displayLengthForAtom,
	offsetForAtom,
	normalizeAtoms,
} from "../query-utils";

type InsertResult = { atoms: QueryAtom[]; caretOffset: number; index: number };

export class QueryInputModel {
	atoms: QueryAtom[];
	caretOffset: number;

	constructor(atoms: QueryAtom[] = [], caretOffset = 0) {
		this.atoms = normalizeAtoms(atoms);
		this.caretOffset = Math.max(0, caretOffset);
	}

	setCaret(offset: number) {
		this.caretOffset = Math.max(0, offset);
	}

	applyInsertText(text: string) {
		if (!text) {
			return;
		}
		let caret = this.caretOffset;
		let updated = [...this.atoms];
		const tokens = text.match(/\s+|\S+/g) ?? [];
		for (const token of tokens) {
			const atom: QueryAtom = /^\s+$/.test(token)
				? { kind: "whitespace", value: " " }
				: { kind: "term", value: token };
			const result = insertAtomAtOffset(updated, atom, caret);
			updated = result.atoms;
			caret = result.caretOffset;
		}
		this.atoms = normalizeAtoms(updated);
		this.caretOffset = Math.min(caret, this.displayLength());
	}

	applyReplaceRange(start: number, end: number, text: string) {
		const startOffset = Math.max(0, Math.min(start, this.displayLength()));
		const endOffset = Math.max(0, Math.min(end, this.displayLength()));
		const rangeStart = Math.min(startOffset, endOffset);
		const rangeEnd = Math.max(startOffset, endOffset);
		if (rangeEnd > rangeStart) {
			this.deleteRange(rangeStart, rangeEnd);
			this.caretOffset = rangeStart;
		}
		if (text) {
			this.caretOffset = rangeStart;
			this.applyInsertText(text);
		} else {
			this.caretOffset = rangeStart;
		}
	}

	applyBackspace() {
		if (this.caretOffset <= 0) {
			return;
		}
		const updated = [...this.atoms];
		const targetOffset = this.caretOffset - 1;
		const info = findAtomAtOffset(updated, targetOffset);
		if (!info) {
			return;
		}
		const { index, cursor, offset, atom } = info;
		if (atom.kind !== "term" && atom.kind !== "whitespace") {
			updated.splice(index, 1);
			this.atoms = normalizeAtoms(updated);
			this.caretOffset = Math.max(0, cursor);
			return;
		}
		const removeIndex = Math.max(
			0,
			Math.min(atom.value.length - 1, offset),
		);
		const nextValue =
			atom.value.slice(0, removeIndex) +
			atom.value.slice(removeIndex + 1);
		if (nextValue.length === 0) {
			updated.splice(index, 1);
		} else {
			updated[index] = { ...atom, value: nextValue };
		}
		this.atoms = normalizeAtoms(updated);
		this.caretOffset = Math.max(0, this.caretOffset - 1);
	}

	applyDeleteForward() {
		const updated = [...this.atoms];
		const info = findAtomAtOffset(updated, this.caretOffset);
		if (!info) {
			return;
		}
		const { index, offset, atom } = info;
		if (atom.kind !== "term" && atom.kind !== "whitespace") {
			updated.splice(index, 1);
			this.atoms = normalizeAtoms(updated);
			return;
		}
		if (offset >= atom.value.length) {
			const next = updated[index + 1];
			if (next && next.kind !== "term" && next.kind !== "whitespace") {
				updated.splice(index + 1, 1);
				this.atoms = normalizeAtoms(updated);
			}
			return;
		}
		const nextValue =
			atom.value.slice(0, offset) + atom.value.slice(offset + 1);
		if (nextValue.length === 0) {
			updated.splice(index, 1);
		} else {
			updated[index] = { ...atom, value: nextValue };
		}
		this.atoms = normalizeAtoms(updated);
	}

	deleteRange(start: number, end: number) {
		const startOffset = Math.max(0, Math.min(start, this.displayLength()));
		const endOffset = Math.max(0, Math.min(end, this.displayLength()));
		const rangeStart = Math.min(startOffset, endOffset);
		const rangeEnd = Math.max(startOffset, endOffset);
		if (rangeEnd <= rangeStart) {
			return;
		}
		const updated: QueryAtom[] = [];
		let cursor = 0;
		for (const atom of this.atoms) {
			const length = displayLengthForAtom(atom);
			const atomEnd = cursor + length;
			if (rangeEnd <= cursor || rangeStart >= atomEnd) {
				updated.push(atom);
				cursor = atomEnd;
				continue;
			}
			if (atom.kind !== "term" && atom.kind !== "whitespace") {
				cursor = atomEnd;
				continue;
			}
			const removeStart = Math.max(rangeStart - cursor, 0);
			const removeEnd = Math.min(rangeEnd - cursor, length);
			const nextValue =
				atom.value.slice(0, removeStart) + atom.value.slice(removeEnd);
			if (nextValue.length > 0) {
				updated.push({ ...atom, value: nextValue });
			}
			cursor = atomEnd;
		}
		this.atoms = normalizeAtoms(updated);
		this.caretOffset = rangeStart;
	}

	insertChip(kind: QueryAtom["kind"], value: string, display?: string) {
		const result = insertAtomAtOffset(
			this.atoms,
			{ kind, value, display },
			this.caretOffset,
		);
		const updated = [...result.atoms];
		const next = updated[result.index + 1];
		let caret = result.caretOffset;
		if (!next || next.kind !== "whitespace") {
			updated.splice(result.index + 1, 0, {
				kind: "whitespace",
				value: " ",
			});
			caret += 1;
		}
		this.atoms = normalizeAtoms(updated);
		this.caretOffset = Math.min(caret, this.displayLength());
	}

	displayString(): string {
		return this.atoms
			.map((atom) => {
				if (atom.kind === "term" || atom.kind === "whitespace") {
					return atom.value;
				}
				return atom.display ?? atom.value;
			})
			.join("");
	}

	displayLength(): number {
		return this.atoms.reduce(
			(total, atom) => total + displayLengthForAtom(atom),
			0,
		);
	}
}

function findAtomAtOffset(
	atoms: QueryAtom[],
	offset: number,
): { index: number; cursor: number; offset: number; atom: QueryAtom } | null {
	let cursor = 0;
	for (let index = 0; index < atoms.length; index += 1) {
		const atom = atoms[index];
		const length = displayLengthForAtom(atom);
		const end = cursor + length;
		if (offset < end || (offset === end && index === atoms.length - 1)) {
			const innerOffset = Math.max(0, offset - cursor);
			return { index, cursor, offset: innerOffset, atom };
		}
		cursor = end;
	}
	return null;
}

function insertAtomAtOffset(
	atoms: QueryAtom[],
	atom: QueryAtom,
	offset: number,
): InsertResult {
	const updated = [...atoms];
	let cursor = 0;
	for (let index = 0; index < updated.length; index += 1) {
		const current = updated[index];
		const length = displayLengthForAtom(current);
		const end = cursor + length;
		if (offset <= end) {
			if (current.kind === "term" || current.kind === "whitespace") {
				const relative = Math.max(0, offset - cursor);
				if (relative <= 0) {
					updated.splice(index, 0, atom);
					return {
						atoms: updated,
						caretOffset:
							offsetForAtom(updated, index) +
							displayLengthForAtom(atom),
						index,
					};
				}
				if (relative >= length) {
					updated.splice(index + 1, 0, atom);
					return {
						atoms: updated,
						caretOffset:
							offsetForAtom(updated, index + 1) +
							displayLengthForAtom(atom),
						index: index + 1,
					};
				}
				const before = current.value.slice(0, relative);
				const after = current.value.slice(relative);
				const insertIndex = index + (before ? 1 : 0);
				const replacement: QueryAtom[] = [];
				if (before) {
					replacement.push({
						kind: current.kind,
						value: before,
					});
				}
				replacement.push(atom);
				if (after) {
					replacement.push({
						kind: current.kind,
						value: after,
					});
				}
				updated.splice(index, 1, ...replacement);
				return {
					atoms: updated,
					caretOffset:
						offsetForAtom(updated, insertIndex) +
						displayLengthForAtom(atom),
					index: insertIndex,
				};
			}
			const insertIndex = offset <= cursor ? index : index + 1;
			updated.splice(insertIndex, 0, atom);
			return {
				atoms: updated,
				caretOffset:
					offsetForAtom(updated, insertIndex) +
					displayLengthForAtom(atom),
				index: insertIndex,
			};
		}
		cursor = end;
	}
	updated.push(atom);
	return {
		atoms: updated,
		caretOffset:
			offsetForAtom(updated, updated.length - 1) +
			displayLengthForAtom(atom),
		index: updated.length - 1,
	};
}
