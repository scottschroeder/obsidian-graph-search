import type { QueryAtom, QueryAtomKind } from "../types";
import {
	chipRawLength,
	getChipParts,
	getChipValueElement,
	isChipElement,
} from "./chip-dom-utils";

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
	if (range.startContainer === root) {
		return computeRawOffsetFromRoot(root, range.startOffset);
	}
	return computeRawOffset(root, range.startContainer, range.startOffset);
}

export function getRangeOffsets(
	root: HTMLElement,
	range: Range,
): { start: number; end: number } | null {
	if (!root.contains(range.startContainer)) {
		return null;
	}
	if (!root.contains(range.endContainer)) {
		return null;
	}
	const start =
		range.startContainer === root
			? computeRawOffsetFromRoot(root, range.startOffset)
			: computeRawOffset(root, range.startContainer, range.startOffset);
	const end =
		range.endContainer === root
			? computeRawOffsetFromRoot(root, range.endOffset)
			: computeRawOffset(root, range.endContainer, range.endOffset);
	return { start, end };
}

function computeRawOffsetFromRoot(
	root: HTMLElement,
	startOffset: number,
): number {
	let offset = 0;
	const children = Array.from(root.childNodes);
	for (let i = 0; i < startOffset && i < children.length; i += 1) {
		offset += rawLength(children[i]);
	}
	return offset;
}

export function restoreCaretOffset(
	root: HTMLElement,
	rawOffset: number,
	options?: { preferBeforeChip?: boolean },
) {
	const selection = window.getSelection();
	if (!selection) {
		return;
	}
	const range = document.createRange();
	const target = findNodeAtRawOffset(
		root,
		rawOffset,
		options?.preferBeforeChip ?? false,
	);
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
	if (isChipElement(node)) {
		const kind = (node.dataset.chipKind ?? "term") as QueryAtomKind;
		const valueEl = getChipValueElement(node);
		const displayText = valueEl?.textContent ?? "";
		const rawValue = node.dataset.chipValue ?? displayText;
		const rawDisplay = node.dataset.chipDisplay ?? displayText;
		const value = rawValue.trim();
		const display = rawDisplay.trim();
		if (value.length === 0) {
			return [];
		}
		const atom: QueryAtom = { kind, value };
		if (display.length > 0 && display !== value) {
			atom.display = display;
		}
		return [atom];
	}
	if (node.nodeType !== Node.ELEMENT_NODE) {
		return [];
	}
	const el = node as HTMLElement;
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
	if (isChipElement(node)) {
		const parts = getChipParts(node);
		return parts.prefix + parts.value + parts.suffix;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) {
		return "";
	}
	const el = node as HTMLElement;
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
		if (isChipElement(node)) {
			if (node.contains(targetNode)) {
				offset += rawOffsetWithinChip(node, targetNode, targetOffset);
				found = true;
				return;
			}
			offset += chipRawLength(node);
			return;
		}
		const el = node as HTMLElement;
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
	const valueEl = getChipValueElement(chip);
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
	if (isChipElement(node)) {
		return chipRawLength(node);
	}
	const el = node as HTMLElement;
	let length = 0;
	el.childNodes.forEach((child) => {
		length += rawLength(child);
	});
	return length;
}

function findNodeAtRawOffset(
	root: HTMLElement,
	rawOffset: number,
	preferBeforeChip: boolean,
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
		if (isChipElement(node)) {
			const parts = getChipParts(node);
			const prefixLen = parts.prefix.length;
			const valueLen = parts.value.length;
			const totalLen = prefixLen + valueLen + parts.suffix.length;
			if (remaining === 0) {
				const prev = node.previousSibling;
				if (prev && prev.nodeType === Node.TEXT_NODE) {
					result = {
						node: prev,
						offset: prev.textContent?.length ?? 0,
					};
					return;
				}
				const parent = node.parentNode;
				if (parent) {
					const index = Array.from(parent.childNodes).indexOf(node);
					result = { node: parent, offset: Math.max(index, 0) };
					return;
				}
			}
			if (remaining > 0 && remaining < totalLen && preferBeforeChip) {
				const prev = node.previousSibling;
				if (prev && prev.nodeType === Node.TEXT_NODE) {
					result = {
						node: prev,
						offset: prev.textContent?.length ?? 0,
					};
					return;
				}
				const parent = node.parentNode;
				if (parent) {
					const index = Array.from(parent.childNodes).indexOf(node);
					result = { node: parent, offset: Math.max(index, 0) };
					return;
				}
			}
			if (remaining <= totalLen) {
				// If we're positioned within the chip's bounds, we should move to
				// the appropriate text node after the chip
				// But we need to position at the correct place for "and" text
				const next = node.nextSibling;
				if (next && next.nodeType === Node.TEXT_NODE) {
					result = { node: next, offset: 0 };
					return;
				}
				// If there's no text node after, we still want to position properly
				const parent = node.parentNode;
				if (parent) {
					const index = Array.from(parent.childNodes).indexOf(node);
					// Position after the chip in parent
					result = { node: parent, offset: Math.max(index + 1, 0) };
					return;
				}
			}
			remaining -= totalLen;
			return;
		}
		const el = node as HTMLElement;
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
	if (isChipElement(node)) {
		const valueEl = getChipValueElement(node);
		const targetNode = valueEl?.firstChild ?? valueEl ?? node;
		return { node: targetNode, offset: valueEl?.textContent?.length ?? 0 };
	}
	const el = node as HTMLElement;
	if (el.childNodes.length === 0) {
		return { node: el, offset: 0 };
	}
	return findEndPosition(el.childNodes[el.childNodes.length - 1]);
}
