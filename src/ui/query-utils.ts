export type ChipSpan = {
	start: number;
	end: number;
	text: string;
	prefix: string;
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

export function formatTagValue(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
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
			return term;
		})
		.filter((term) => term.length > 0);
}

export function extractBodyTerms(baseQuery: string): string[] {
	return baseQuery
		.split(/\s+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0)
		.filter((term) => {
			const lowered = term.toLowerCase();
			if (lowered.startsWith("tag:")) {
				return false;
			}
			if (lowered.startsWith("path:")) {
				return false;
			}
			if (lowered.startsWith("#")) {
				return false;
			}
			return true;
		});
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

export function escapeHtmlAttribute(value: string): string {
	return escapeHtml(value).replace(/\n/g, "&#10;");
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

export function extractRawFromEditable(root: HTMLElement): string {
	let raw = "";
	root.childNodes.forEach((node) => {
		raw += extractRawFromNode(node);
	});
	return raw;
}

export function getCaretOffset(root: HTMLElement): number | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}
	const range = selection.getRangeAt(0);
	if (!root.contains(range.startContainer)) {
		return null;
	}
	return computeRawOffset(root, range.startContainer, range.startOffset);
}

export function restoreCaretOffset(root: HTMLElement, rawOffset: number) {
	const selection = window.getSelection();
	if (!selection) {
		return;
	}
	const range = document.createRange();
	const target = findNodeAtRawOffset(root, rawOffset);
	if (target) {
		range.setStart(target.node, target.offset);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		return;
	}
	if (root.childNodes.length > 0) {
		const lastNode = root.childNodes[root.childNodes.length - 1];
		const endTarget = findEndPosition(lastNode);
		range.setStart(endTarget.node, endTarget.offset);
	} else {
		range.setStart(root, 0);
	}
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

function extractRawFromNode(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent ?? "";
	}
	if (node.nodeType !== Node.ELEMENT_NODE) {
		return "";
	}
	const el = node as HTMLElement;
	if (el.classList.contains("graph-search-chip")) {
		const parts = getChipParts(el);
		return parts.prefix + parts.value + parts.suffix;
	}
	let raw = "";
	el.childNodes.forEach((child) => {
		raw += extractRawFromNode(child);
	});
	return raw;
}

function computeRawOffset(
	root: HTMLElement,
	targetNode: Node,
	targetOffset: number,
): number {
	let offset = 0;
	let found = false;
	const walk = (node: Node) => {
		if (found) {
			return;
		}
		if (node === targetNode) {
			if (node.nodeType === Node.TEXT_NODE) {
				offset += targetOffset;
				found = true;
				return;
			}
			if (node.nodeType === Node.ELEMENT_NODE) {
				const children = Array.from(node.childNodes);
				for (
					let i = 0;
					i < targetOffset && i < children.length;
					i += 1
				) {
					offset += rawLength(children[i]);
				}
				found = true;
				return;
			}
		}
		if (node.nodeType === Node.TEXT_NODE) {
			offset += node.textContent?.length ?? 0;
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) {
			return;
		}
		const el = node as HTMLElement;
		if (el.classList.contains("graph-search-chip")) {
			if (el.contains(targetNode)) {
				offset += rawOffsetWithinChip(el, targetNode, targetOffset);
				found = true;
				return;
			}
			offset += chipRawLength(el);
			return;
		}
		el.childNodes.forEach((child) => walk(child));
	};
	root.childNodes.forEach((child) => walk(child));
	return offset;
}

function rawOffsetWithinChip(
	chip: HTMLElement,
	targetNode: Node,
	targetOffset: number,
): number {
	const parts = getChipParts(chip);
	const valueEl = chip.querySelector(
		".graph-search-chip-value",
	) as HTMLElement | null;
	if (!valueEl) {
		return parts.prefix.length;
	}
	let valueOffset = 0;
	let found = false;
	const walkValue = (node: Node) => {
		if (found) {
			return;
		}
		if (node === targetNode) {
			if (node.nodeType === Node.TEXT_NODE) {
				valueOffset += targetOffset;
				found = true;
				return;
			}
			if (node.nodeType === Node.ELEMENT_NODE) {
				const children = Array.from(node.childNodes);
				for (
					let i = 0;
					i < targetOffset && i < children.length;
					i += 1
				) {
					valueOffset += rawLength(children[i]);
				}
				found = true;
				return;
			}
		}
		if (node.nodeType === Node.TEXT_NODE) {
			valueOffset += node.textContent?.length ?? 0;
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) {
			return;
		}
		node.childNodes.forEach((child) => walkValue(child));
	};
	valueEl.childNodes.forEach((child) => walkValue(child));
	if (!found) {
		valueOffset = parts.value.length;
	}
	return parts.prefix.length + Math.min(valueOffset, parts.value.length);
}

function rawLength(node: Node): number {
	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent?.length ?? 0;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) {
		return 0;
	}
	const el = node as HTMLElement;
	if (el.classList.contains("graph-search-chip")) {
		return chipRawLength(el);
	}
	let length = 0;
	el.childNodes.forEach((child) => {
		length += rawLength(child);
	});
	return length;
}

function chipRawLength(chip: HTMLElement): number {
	const parts = getChipParts(chip);
	return parts.prefix.length + parts.value.length + parts.suffix.length;
}

function getChipParts(chip: HTMLElement): {
	prefix: string;
	value: string;
	suffix: string;
} {
	const prefix = chip.dataset.rawPrefix ?? "";
	const suffix = chip.dataset.rawSuffix ?? "";
	const valueEl = chip.querySelector(
		".graph-search-chip-value",
	) as HTMLElement | null;
	const value = valueEl?.textContent ?? "";
	return { prefix, value, suffix };
}

function findNodeAtRawOffset(
	root: HTMLElement,
	rawOffset: number,
): { node: Node; offset: number } | null {
	let remaining = rawOffset;
	let result: { node: Node; offset: number } | null = null;
	const walk = (node: Node) => {
		if (result) {
			return;
		}
		if (node.nodeType === Node.TEXT_NODE) {
			const length = node.textContent?.length ?? 0;
			if (remaining <= length) {
				result = { node, offset: remaining };
				return;
			}
			remaining -= length;
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) {
			return;
		}
		const el = node as HTMLElement;
		if (el.classList.contains("graph-search-chip")) {
			const parts = getChipParts(el);
			const prefixLen = parts.prefix.length;
			const valueLen = parts.value.length;
			const totalLen = prefixLen + valueLen + parts.suffix.length;
			if (remaining === 0) {
				const prev = el.previousSibling;
				if (prev && prev.nodeType === Node.TEXT_NODE) {
					result = {
						node: prev,
						offset: prev.textContent?.length ?? 0,
					};
					return;
				}
				const parent = el.parentNode;
				if (parent) {
					const index = Array.from(parent.childNodes).indexOf(el);
					result = { node: parent, offset: Math.max(index, 0) };
					return;
				}
			}
			if (remaining <= totalLen) {
				const next = el.nextSibling;
				if (next && next.nodeType === Node.TEXT_NODE) {
					result = { node: next, offset: 0 };
					return;
				}
				const parent = el.parentNode;
				if (parent) {
					const index = Array.from(parent.childNodes).indexOf(el);
					result = { node: parent, offset: Math.max(index + 1, 0) };
					return;
				}
			}
			remaining -= totalLen;
			return;
		}
		el.childNodes.forEach((child) => walk(child));
	};
	root.childNodes.forEach((child) => walk(child));
	return result;
}

function findEndPosition(node: Node): { node: Node; offset: number } {
	if (node.nodeType === Node.TEXT_NODE) {
		return { node, offset: node.textContent?.length ?? 0 };
	}
	if (node.nodeType !== Node.ELEMENT_NODE) {
		return { node, offset: 0 };
	}
	const el = node as HTMLElement;
	if (el.classList.contains("graph-search-chip")) {
		const valueEl = el.querySelector(
			".graph-search-chip-value",
		) as HTMLElement | null;
		const targetNode = valueEl?.firstChild ?? valueEl ?? el;
		return { node: targetNode, offset: valueEl?.textContent?.length ?? 0 };
	}
	if (el.childNodes.length === 0) {
		return { node: el, offset: 0 };
	}
	return findEndPosition(el.childNodes[el.childNodes.length - 1]);
}
