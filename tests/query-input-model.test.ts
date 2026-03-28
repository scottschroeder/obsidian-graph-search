import { describe, expect, it } from "vitest";

import type { QueryAtom } from "../ui/types";
import { QueryInputModel } from "../ui/query-input/query-input-model";

function term(value: string): QueryAtom {
	return { kind: "term", value };
}

function whitespace(): QueryAtom {
	return { kind: "whitespace", value: " " };
}

function chip(
	kind: Exclude<QueryAtom["kind"], "term" | "whitespace">,
	value: string,
	display = value,
): QueryAtom {
	return { kind, value, display };
}

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

	it("deletes the previous word and allows replacement text", () => {
		const model = new QueryInputModel();
		model.applyInsertText("foo");
		model.applyDeleteWordBackward();
		model.applyInsertText("x");
		expect(formatAtoms(model.atoms)).toBe("x");
		expect(model.caretOffset).toBe(1);
	});

	it("deletes the next word and trailing whitespace", () => {
		const model = new QueryInputModel(
			[term("foo"), whitespace(), term("bar")],
			0,
		);
		model.applyDeleteWordForward();
		expect(formatAtoms(model.atoms)).toBe("bar");
		expect(model.caretOffset).toBe(0);
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
			term("foo"),
			whitespace(),
			chip("near", "Note"),
			whitespace(),
			term("bar"),
		]);
		model.deleteRange(4, 9);
		expect(formatAtoms(model.atoms)).toBe("foo bar");
		expect(model.caretOffset).toBe(4);
	});

	it("inserts a chip after the latest existing chip", () => {
		const model = new QueryInputModel([
			term("foo"),
			whitespace(),
			chip("tag", "#x"),
			whitespace(),
			term("bar"),
		]);

		model.insertChipAfterLastChip("near", "FooBar", "FooBar");

		expect(formatAtoms(model.atoms)).toBe("foo [tag:#x] [near:FooBar] bar");
	});

	it("uses the actual last chip when multiple chips exist", () => {
		const model = new QueryInputModel([
			chip("near", "Note1"),
			whitespace(),
			term("foo"),
			whitespace(),
			chip("tag", "#x"),
			whitespace(),
			term("bar"),
		]);

		model.insertChipAfterLastChip("near", "FooBar", "FooBar");

		expect(formatAtoms(model.atoms)).toBe(
			"[near:Note1] foo [tag:#x] [near:FooBar] bar",
		);
	});

	it("prepends a chip when there are no existing chips", () => {
		const model = new QueryInputModel([term("foo")], 3);

		model.insertChipAfterLastChip("near", "FooBar", "FooBar");

		expect(formatAtoms(model.atoms)).toBe("[near:FooBar] foo");
		expect(model.caretOffset).toBe(10);
	});

	it("adds a single trailing space when inserting after a chip at the end", () => {
		const model = new QueryInputModel([
			term("foo"),
			whitespace(),
			chip("near", "Note1"),
		]);

		model.insertChipAfterLastChip("near", "FooBar", "FooBar");

		expect(formatAtoms(model.atoms)).toBe(
			"foo [near:Note1] [near:FooBar] ",
		);
	});

	it("keeps the caret in place when it is before the insertion point", () => {
		const model = new QueryInputModel(
			[
				term("foo"),
				whitespace(),
				chip("tag", "#x"),
				whitespace(),
				term("bar"),
			],
			2,
		);

		model.insertChipAfterLastChip("near", "FooBar", "FooBar");

		expect(formatAtoms(model.atoms)).toBe("foo [tag:#x] [near:FooBar] bar");
		expect(model.caretOffset).toBe(2);
	});

	it("shifts the caret by inserted display length when it is after the insertion point", () => {
		const model = new QueryInputModel(
			[
				term("foo"),
				whitespace(),
				chip("tag", "#x"),
				whitespace(),
				term("bar"),
			],
			10,
		);

		model.insertChipAfterLastChip("near", "notes/alpha.md", "alpha");

		expect(formatAtoms(model.atoms)).toBe("foo [tag:#x] [near:alpha] bar");
		expect(model.caretOffset).toBe(16);
	});

	it("moves the caret with the inserted chip when it is exactly at the insertion point", () => {
		const model = new QueryInputModel(
			[
				term("foo"),
				whitespace(),
				chip("tag", "#x"),
				whitespace(),
				term("bar"),
			],
			6,
		);

		model.insertChipAfterLastChip("near", "notes/alpha.md", "alpha");

		expect(formatAtoms(model.atoms)).toBe("foo [tag:#x] [near:alpha] bar");
		expect(model.caretOffset).toBe(12);
	});
});
