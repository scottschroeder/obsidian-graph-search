import { describe, expect, it } from "vitest";

import type { QueryAtom } from "../ui/types";

import { normalizeAtoms } from "../ui/query-utils";

describe("normalizeAtoms", () => {
	it("merges consecutive term atoms", () => {
		const atoms: QueryAtom[] = [
			{ kind: "term", value: "hello" },
			{ kind: "term", value: "world" },
		];
		const result = normalizeAtoms(atoms);
		expect(result).toEqual([{ kind: "term", value: "helloworld" }]);
	});

	it("strips leading whitespace atoms", () => {
		const atoms: QueryAtom[] = [
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "hello" },
		];
		const result = normalizeAtoms(atoms);
		expect(result).toEqual([{ kind: "term", value: "hello" }]);
	});

	it("collapses multiple whitespace atoms", () => {
		const atoms: QueryAtom[] = [
			{ kind: "term", value: "hello" },
			{ kind: "whitespace", value: " " },
			{ kind: "whitespace", value: " " },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "world" },
		];
		const result = normalizeAtoms(atoms);
		expect(result).toEqual([
			{ kind: "term", value: "hello" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "world" },
		]);
	});

	it("trims empty values from atoms", () => {
		const atoms: QueryAtom[] = [
			{ kind: "term", value: "  " },
			{ kind: "term", value: "hello" },
			{ kind: "term", value: "" },
		];
		const result = normalizeAtoms(atoms);
		expect(result).toEqual([{ kind: "term", value: "hello" }]);
	});
});
