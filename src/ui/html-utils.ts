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
	return snippet;
}

export function buildSnippetNodes(
	snippet: string,
	terms: string[],
): DocumentFragment {
	const fragment = document.createDocumentFragment();
	if (!snippet) {
		return fragment;
	}
	const normalizedTerms = normalizeHighlightTerms(terms);
	if (normalizedTerms.length === 0) {
		fragment.appendChild(document.createTextNode(snippet));
		return fragment;
	}
	const pattern = buildHighlightPattern(normalizedTerms);
	if (!pattern) {
		fragment.appendChild(document.createTextNode(snippet));
		return fragment;
	}
	const regex = new RegExp(pattern, "gi");
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(snippet)) !== null) {
		if (!match[0]) {
			regex.lastIndex += 1;
			continue;
		}
		const start = match.index;
		const end = match.index + match[0].length;
		if (start > lastIndex) {
			fragment.appendChild(
				document.createTextNode(snippet.slice(lastIndex, start)),
			);
		}
		const highlight = document.createElement("span");
		highlight.className = "graph-search-highlight";
		highlight.textContent = snippet.slice(start, end);
		fragment.appendChild(highlight);
		lastIndex = end;
	}
	if (lastIndex < snippet.length) {
		fragment.appendChild(document.createTextNode(snippet.slice(lastIndex)));
	}
	return fragment;
}

function normalizeHighlightTerms(terms: string[]): string[] {
	const normalized = terms
		.map((term) => term.replace(/^#/, "").trim())
		.filter((term) => term.length > 0);
	return Array.from(new Set(normalized));
}

function buildHighlightPattern(terms: string[]): string {
	const sorted = [...terms].sort((a, b) => b.length - a.length);
	const escaped = sorted.map((term) => escapeRegExp(term)).filter(Boolean);
	return escaped.join("|");
}
