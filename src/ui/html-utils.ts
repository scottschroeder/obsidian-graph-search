import escapeHtml from "escape-html";

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
