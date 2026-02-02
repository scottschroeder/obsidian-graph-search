import escapeHtml from "escape-html";
import type { QueryAtom } from "./types";
import { type ChipSpan, findTokenRange } from "./query-utils";

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

export function buildSnippet(body: string, terms: string[]): string {
	if (!body) {
		return "";
	}
	const cleaned = body.replace(/\s+/g, " ").trim();
	if (!cleaned) {
		return "";
	}
	if (terms.length === 0) {
		return "";
	}
	const lowered = cleaned.toLowerCase();
	let matchIndex = -1;
	for (const term of terms) {
		const normalized = term.replace(/^#/, "").toLowerCase();
		if (!normalized) {
			continue;
		}
		const index = lowered.indexOf(normalized);
		if (index >= 0 && (matchIndex === -1 || index < matchIndex)) {
			matchIndex = index;
		}
	}
	if (matchIndex < 0) {
		return "";
	}
	const windowSize = 120;
	let start = 0;
	start = Math.max(0, matchIndex - Math.floor(windowSize / 2));
	const snippet = cleaned.slice(start, start + windowSize);
	return highlightSnippet(snippet, terms);
}

export function highlightSnippet(snippet: string, terms: string[]): string {
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
