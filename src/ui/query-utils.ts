import type { QueryAtom } from "./types";
import { stripMdExtension } from "../link-utils";

export function normalizeAtoms(atoms: QueryAtom[]): QueryAtom[] {
	const normalized: QueryAtom[] = [];
	for (const atom of atoms) {
		if (atom.kind === "whitespace") {
			if (normalized.length === 0) {
				continue;
			}
			const last = normalized[normalized.length - 1];
			if (last.kind === "whitespace") {
				continue;
			}
			normalized.push({ kind: "whitespace", value: " " });
			continue;
		}
		const trimmed = atom.value.trim();
		if (!trimmed) {
			continue;
		}
		const trimmedDisplay = atom.display?.trim();
		const last = normalized[normalized.length - 1];
		if (last && last.kind === "term" && atom.kind === "term") {
			last.value += trimmed;
			continue;
		}
		const next: QueryAtom = { kind: atom.kind, value: trimmed };
		if (trimmedDisplay && trimmedDisplay.length > 0) {
			next.display = trimmedDisplay;
		}
		normalized.push(next);
	}
	return normalized.filter((atom) => atom.value.length > 0);
}

export type ChipSpan = {
	start: number;
	end: number;
	text: string;
	prefix: string;
};

export function buildRawFromAtoms(atoms: QueryAtom[]): string {
	return atoms
		.filter((atom) => atom.kind === "term")
		.map((atom) => atom.value.trim())
		.filter((value) => value.length > 0)
		.join(" ");
}

export function findTokenAtCursor(
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

export function formatTagValue(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function extractBodyTermsFromAtoms(atoms: QueryAtom[]): string[] {
	return atoms
		.filter((atom) => atom.kind === "term")
		.map((atom) => atom.value.trim())
		.filter((term) => term.length > 0);
}

export function displayLengthForAtom(atom: QueryAtom): number {
	if (atom.kind === "term" || atom.kind === "whitespace") {
		return atom.value.length;
	}
	return (atom.display ?? atom.value).length;
}

export function displayLengthForAtoms(atoms: QueryAtom[]): number {
	return atoms.reduce((total, atom) => total + displayLengthForAtom(atom), 0);
}

export function offsetForAtom(atoms: QueryAtom[], index: number): number {
	let offset = 0;
	for (let i = 0; i < atoms.length; i += 1) {
		if (i === index) {
			return offset;
		}
		offset += displayLengthForAtom(atoms[i]);
	}
	return offset;
}

export { stripMdExtension };

export function isColonInsert(event: Event): boolean {
	if (!(event instanceof InputEvent)) {
		return false;
	}
	return event.inputType === "insertText" && event.data === ":";
}

export function findSpanAtCursor(
	spans: ChipSpan[],
	cursor: number,
): ChipSpan | null {
	return (
		spans.find((span) => cursor >= span.start && cursor <= span.end) ?? null
	);
}

export function findTokenRange(
	value: string,
	span: ChipSpan,
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
	if (!token.startsWith(span.prefix)) {
		let prefixEnd = start;
		let seek = prefixEnd;
		while (seek > 0 && /\s/.test(value[seek - 1])) {
			seek -= 1;
		}
		if (seek === 0 && prefixEnd === start) {
			return null;
		}
		const prefixTokenEnd = seek;
		let prefixStart = prefixTokenEnd;
		while (prefixStart > 0 && !/\s/.test(value[prefixStart - 1])) {
			prefixStart -= 1;
		}
		const prefixToken = value.slice(prefixStart, prefixTokenEnd);
		if (prefixToken !== span.prefix) {
			return null;
		}
		return { start: prefixStart, end };
	}
	return { start, end };
}

export function removeRange(
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
