import type { QueryAtom } from "../types";

export function buildEditableDomFromAtoms(
	atoms: QueryAtom[],
): DocumentFragment {
	const fragment = document.createDocumentFragment();
	if (atoms.length === 0) {
		return fragment;
	}
	atoms.forEach((atom) => {
		const value = atom.value;
		if (!value) {
			return;
		}
		if (atom.kind === "term" || atom.kind === "whitespace") {
			fragment.appendChild(document.createTextNode(value));
			return;
		}
		const display = atom.display ?? value;
		fragment.appendChild(
			buildChipElement({
				kind: atom.kind,
				value,
				display,
			}),
		);
	});
	return fragment;
}

function buildChipElement(input: {
	kind: QueryAtom["kind"];
	value: string;
	display: string;
}): HTMLElement {
	const chip = document.createElement("span");
	chip.className = "graph-search-chip";
	chip.setAttribute("contenteditable", "false");
	chip.dataset.chipKind = input.kind;
	chip.dataset.chipValue = input.value;
	chip.dataset.chipDisplay = input.display;
	chip.dataset.rawPrefix = "";
	chip.dataset.rawSuffix = "";

	const hiddenStart = document.createElement("span");
	hiddenStart.className = "graph-search-chip-hidden";
	const valueSpan = document.createElement("span");
	valueSpan.className = "graph-search-chip-value";
	valueSpan.textContent = input.display;
	const hiddenEnd = document.createElement("span");
	hiddenEnd.className = "graph-search-chip-hidden";

	chip.appendChild(hiddenStart);
	chip.appendChild(valueSpan);
	chip.appendChild(hiddenEnd);
	return chip;
}
