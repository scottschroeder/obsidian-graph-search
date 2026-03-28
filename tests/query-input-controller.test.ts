import { describe, expect, it } from "vitest";

import type { QueryAtom } from "../ui/types";
import { restoreCaretOffset } from "../ui/query-input/editable-dom";
import { QueryInputController } from "../ui/query-modal/input-controller";

function formatAtoms(atoms: QueryAtom[]): string {
	return atoms
		.map((atom) => {
			if (atom.kind === "term" || atom.kind === "whitespace") {
				return atom.value;
			}
			const label = atom.display ?? atom.value;
			return `[${atom.kind}:${label}]`;
		})
		.join("");
}

describe("QueryInputController", () => {
	it("inserts a near chip after the latest chip", () => {
		const inputEl = document.createElement("div");
		let latestAtoms: QueryAtom[] = [];
		let latestRawQuery = "";

		const controller = new QueryInputController({
			inputEl,
			onChange: (atoms, rawQuery) => {
				latestAtoms = atoms;
				latestRawQuery = rawQuery;
			},
		});

		controller.insertChipAfterLastChip("near", "notes/alpha.md", "alpha");

		expect(formatAtoms(latestAtoms)).toBe("[near:alpha] ");
		expect(latestRawQuery).toBe("");
	});

	it("handles deleteWordBackward without reviving deleted text", () => {
		const inputEl = document.createElement("div");
		inputEl.setAttribute("contenteditable", "true");
		document.body.appendChild(inputEl);
		let latestRawQuery = "";

		new QueryInputController({
			inputEl,
			onChange: (_atoms, rawQuery) => {
				latestRawQuery = rawQuery;
			},
		});

		try {
			restoreCaretOffset(inputEl, 0);
			dispatchBeforeInput(inputEl, "insertText", "f");
			dispatchBeforeInput(inputEl, "insertText", "o");
			dispatchBeforeInput(inputEl, "insertText", "o");
			dispatchBeforeInput(inputEl, "deleteWordBackward");
			dispatchBeforeInput(inputEl, "insertText", "x");

			expect(latestRawQuery).toBe("x");
			expect(inputEl.textContent).toBe("x");
		} finally {
			document.body.removeChild(inputEl);
		}
	});
});

function dispatchBeforeInput(
	inputEl: HTMLDivElement,
	inputType: string,
	data?: string,
) {
	const event = new InputEvent("beforeinput", {
		bubbles: true,
		cancelable: true,
		data,
		inputType,
	});
	inputEl.dispatchEvent(event);
}
