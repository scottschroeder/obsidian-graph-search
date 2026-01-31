import type { QueryAtom, QueryAtomKind } from "./types";

export function extractAtomsFromEditable(root: HTMLElement): QueryAtom[] {
	const atoms: QueryAtom[] = [];
	root.childNodes.forEach((node) => {
		atoms.push(...extractAtomsFromNode(node));
	});
	return atoms;
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

function extractAtomsFromNode(node: Node): QueryAtom[] {
	if (node.nodeType === Node.TEXT_NODE) {
		const text = node.textContent ?? "";
		const tokens = text.match(/\s+|\S+/g) ?? [];
		return tokens.map((token) => {
			if (/^\s+$/.test(token)) {
				return { kind: "whitespace" as const, value: " " };
			}
			return { kind: "term" as const, value: token };
		});
	}
	if (node.nodeType !== Node.ELEMENT_NODE) {
		return [];
	}
	const el = node as HTMLElement;
	if (el.classList.contains("graph-search-chip")) {
		const kind = (el.dataset.chipKind ?? "term") as QueryAtomKind;
		const valueEl = el.querySelector(
			".graph-search-chip-value",
		) as HTMLElement | null;
		const value = valueEl?.textContent ?? "";
		return value.trim().length > 0 ? [{ kind, value: value.trim() }] : [];
	}
	const atoms: QueryAtom[] = [];
	el.childNodes.forEach((child) => {
		atoms.push(...extractAtomsFromNode(child));
	});
	return atoms;
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
				// If we're positioned within the chip's bounds, we should move to
				// the appropriate text node after the chip
				// But we need to position at the correct place for "and" text
				const next = el.nextSibling;
				if (next && next.nodeType === Node.TEXT_NODE) {
					result = { node: next, offset: 0 };
					return;
				}
				// If there's no text node after, we still want to position properly
				const parent = el.parentNode;
				if (parent) {
					const index = Array.from(parent.childNodes).indexOf(el);
					// Position after the chip in parent
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
