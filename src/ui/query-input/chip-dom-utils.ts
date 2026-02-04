export const CHIP_CLASS = "graph-search-chip";
export const CHIP_VALUE_CLASS = "graph-search-chip-value";

export function isChipElement(node: Node): node is HTMLElement {
	return node instanceof HTMLElement && node.classList.contains(CHIP_CLASS);
}

export function getChipValueElement(chip: HTMLElement): HTMLElement | null {
	return chip.querySelector(`.${CHIP_VALUE_CLASS}`) as HTMLElement | null;
}

export function getChipParts(chip: HTMLElement): {
	prefix: string;
	value: string;
	suffix: string;
} {
	const prefix = chip.dataset.rawPrefix ?? "";
	const suffix = chip.dataset.rawSuffix ?? "";
	const valueEl = getChipValueElement(chip);
	const value = valueEl?.textContent ?? "";
	return { prefix, value, suffix };
}

export function chipRawLength(chip: HTMLElement): number {
	const parts = getChipParts(chip);
	return parts.prefix.length + parts.value.length + parts.suffix.length;
}
