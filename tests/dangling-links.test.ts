import { describe, expect, it } from "vitest";

import { buildDanglingGraphInput } from "../src/link-utils";

describe("dangling links", () => {
	it("creates nodes and edges for unresolved links", () => {
		const result = buildDanglingGraphInput({
			unresolvedLinks: {
				"Plans.md": {
					Waterski: 1,
				},
			},
			existingPaths: ["Plans.md"],
			existingTitles: ["Plans"],
		});

		expect(result.nodes).toEqual([
			{ title: "Waterski", path: "__dangling__/Waterski" },
		]);
		expect(result.edges).toEqual([
			{ from: "Plans.md", to: "__dangling__/Waterski" },
		]);
	});

	it("ignores unresolved links that match existing notes", () => {
		const result = buildDanglingGraphInput({
			unresolvedLinks: {
				"Plans.md": {
					"Projects/Alpha": 1,
					"Projects/Beta.md#section": 1,
				},
			},
			existingPaths: ["Projects/Alpha.md", "Projects/Beta.md"],
			existingTitles: [],
		});

		expect(result.nodes).toEqual([]);
		expect(result.edges).toEqual([]);
	});
});
