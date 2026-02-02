import escapeHtml from "escape-html";
import type { QueryAtom } from "../types";
import { type ChipSpan, findTokenRange } from "../query-utils";

export function escapeHtmlAttribute(value: string): string {
	return escapeHtml(value).replace(/\n/g, "&#10;");
}

export function buildEditableHtmlFromAtoms(atoms: QueryAtom[]): string {
	if (atoms.length === 0) {
		return "";
	}
	const parts: string[] = [];
	atoms.forEach((atom) => {
		const value = atom.value;
		if (!value) {
			return;
		}
		if (atom.kind === "term" || atom.kind === "whitespace") {
			parts.push(escapeHtml(value));
			return;
		}
		const display = atom.display ?? value;
		parts.push(
			`<span class="graph-search-chip" contenteditable="false" data-chip-kind="${escapeHtmlAttribute(
				atom.kind,
			)}" data-chip-value="${escapeHtmlAttribute(
				value,
			)}" data-chip-display="${escapeHtmlAttribute(
				display,
			)}" data-raw-prefix="" data-raw-suffix=""><span class="graph-search-chip-hidden"></span><span class="graph-search-chip-value">${escapeHtml(
				display,
			)}</span><span class="graph-search-chip-hidden"></span></span>`,
		);
	});
	return parts.join("");
}

export function buildOverlayHtml(
	value: string,
	spans: ChipSpan[],
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

export function buildEditableHtml(value: string, spans: ChipSpan[]): string {
	if (!value) {
		return "";
	}
	const sorted = [...spans].sort((a, b) => a.start - b.start);
	let html = "";
	let lastIndex = 0;

	for (const span of sorted) {
		const tokenRange = findTokenRange(value, span);
		if (!tokenRange) {
			continue;
		}
		html += escapeHtml(value.slice(lastIndex, tokenRange.start));
		const prefix = value.slice(tokenRange.start, span.start);
		const suffix = value.slice(span.end, tokenRange.end);
		html += `<span class="graph-search-chip" contenteditable="false" data-raw-prefix="${escapeHtmlAttribute(prefix)}" data-raw-suffix="${escapeHtmlAttribute(suffix)}"><span class="graph-search-chip-hidden">${escapeHtml(prefix)}</span><span class="graph-search-chip-value">${escapeHtml(span.text)}</span><span class="graph-search-chip-hidden">${escapeHtml(suffix)}</span></span>`;
		lastIndex = tokenRange.end;
	}

	html += escapeHtml(value.slice(lastIndex));
	return html;
}
