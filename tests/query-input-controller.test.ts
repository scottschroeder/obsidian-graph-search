import { describe, expect, it } from "vitest";

import type { QueryAtom } from "../ui/types";
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
});
