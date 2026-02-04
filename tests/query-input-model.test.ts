import { describe, expect, it } from "vitest";

import type { QueryAtom } from "../ui/types";
import { QueryInputModel } from "../ui/query-input/query-input-model";

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

describe("QueryInputModel", () => {
	it("types a term and fixes a typo with backspace", () => {
		const model = new QueryInputModel();
		model.applyInsertText("f");
		model.applyInsertText("o");
		model.applyInsertText("p");
		model.applyBackspace();
		model.applyInsertText("o");
		expect(formatAtoms(model.atoms)).toBe("foo");
		expect(model.caretOffset).toBe(3);
	});

	it("backspaces through multiple terms", () => {
		const model = new QueryInputModel();
		model.applyInsertText("foo bar");
		model.applyBackspace();
		model.applyBackspace();
		model.applyBackspace();
		model.applyBackspace();
		expect(formatAtoms(model.atoms)).toBe("foo");
		model.applyBackspace();
		model.applyBackspace();
		model.applyBackspace();
		expect(formatAtoms(model.atoms)).toBe("");
	});

	it("inserts in the middle of a term", () => {
		const model = new QueryInputModel();
		model.applyInsertText("fob");
		model.setCaret(2);
		model.applyInsertText("o");
		expect(formatAtoms(model.atoms)).toBe("foob");
		expect(model.caretOffset).toBe(3);
	});

	it("types terms around a chip", () => {
		const model = new QueryInputModel();
		model.applyInsertText("foo ");
		model.insertChip("near", "MyNote", "MyNote");
		model.applyInsertText("bar");
		expect(formatAtoms(model.atoms)).toBe("foo [near:MyNote] bar");
	});

	it("inserts before a chip after deleting", () => {
		const model = new QueryInputModel(
			[
				{ kind: "term", value: "foo" },
				{ kind: "whitespace", value: " " },
				{ kind: "near", value: "MyNote", display: "MyNote" },
			],
			4,
		);
		model.applyBackspace();
		model.applyBackspace();
		model.applyBackspace();
		model.applyBackspace();
		model.applyInsertText("foo");
		expect(formatAtoms(model.atoms)).toBe("foo[near:MyNote]");
		model.applyInsertText(" ");
		expect(formatAtoms(model.atoms)).toBe("foo [near:MyNote]");
	});

	it("replaces a selected range inside a term", () => {
		const model = new QueryInputModel([{ kind: "term", value: "food" }], 4);
		model.applyReplaceRange(1, 3, "a");
		expect(formatAtoms(model.atoms)).toBe("fad");
		expect(model.caretOffset).toBe(2);
	});

	it("deletes a selection that spans a chip", () => {
		const model = new QueryInputModel([
			{ kind: "term", value: "foo" },
			{ kind: "whitespace", value: " " },
			{ kind: "near", value: "Note", display: "Note" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "bar" },
		]);
		model.deleteRange(4, 9);
		expect(formatAtoms(model.atoms)).toBe("foo bar");
		expect(model.caretOffset).toBe(4);
	});
});
