export type NearSpan = {
	start: number;
	end: number;
	text: string;
};

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

export function formatNearValue(value: string): string {
	const trimmed = stripMdExtension(value.trim());
	return trimmed.includes(" ") ? `"${trimmed}"` : trimmed;
}

export function extractSearchTerms(baseQuery: string): string[] {
	return baseQuery
		.split(/\s+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0)
		.map((term) => {
			if (term.startsWith("tag:")) {
				return term.slice(4);
			}
			if (term.startsWith("path:")) {
				return term.slice(5);
			}
			if (term.startsWith("file:")) {
				return term.slice(5);
			}
			return term;
		})
		.filter((term) => term.length > 0);
}

export function buildSnippet(body: string, terms: string[]): string {
	if (!body) {
		return "";
	}
	const cleaned = body.replace(/\s+/g, " ").trim();
	if (!cleaned) {
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
	const windowSize = 120;
	let start = 0;
	if (matchIndex >= 0) {
		start = Math.max(0, matchIndex - Math.floor(windowSize / 2));
	}
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

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripMdExtension(value: string): string {
	return value.toLowerCase().endsWith(".md") ? value.slice(0, -3) : value;
}

export function isColonInsert(event: Event): boolean {
	if (!(event instanceof InputEvent)) {
		return false;
	}
	return event.inputType === "insertText" && event.data === ":";
}

export function buildOverlayHtml(
	value: string,
	spans: NearSpan[],
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

export function findSpanAtCursor(
	spans: NearSpan[],
	cursor: number,
): NearSpan | null {
	return (
		spans.find(
			(span) => cursor >= span.start && cursor <= span.end,
		) ?? null
	);
}

export function findNearTokenRange(
	value: string,
	span: NearSpan,
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
	if (!token.startsWith("near:")) {
		return null;
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
