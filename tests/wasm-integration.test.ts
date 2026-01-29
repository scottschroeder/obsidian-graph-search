import { readFileSync } from "node:fs";
import * as path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { initSync } from "../pkg/obsidian_rust_plugin.js";
import * as wasm from "../pkg/obsidian_rust_plugin.js";

beforeAll(() => {
	const wasmPath = path.resolve(
		process.cwd(),
		"pkg/obsidian_rust_plugin_bg.wasm",
	);
	const bytes = readFileSync(wasmPath);
	initSync({ module: bytes });
});

describe("wasm integration", () => {
	it("parses query and layout", () => {
		const parsed = wasm.parse_query("budget near:alpha");
		expect(parsed.near_titles).toEqual(["alpha"]);
		const layout = wasm.parse_query_layout("near:\"alpha beta\"");
		expect(layout.near_spans.length).toBe(1);
	});

	it("indexes and searches documents", () => {
		const stats = wasm.search_index([
			{
				title: "Budget Meeting",
				path: "meetings/budget.md",
				body: "Agenda for #meeting budget review",
			},
			{
				title: "Project Plan",
				path: "projects/plan.md",
				body: "#project plan scope",
			},
		]);
		expect(stats.doc_count).toBe(2);
		const results = wasm.search_candidates("budget");
		expect(results.length).toBe(1);
		expect(results[0].path).toBe("meetings/budget.md");
	});

	it("ranks candidates by graph proximity", () => {
		const graphStats = wasm.graph_init(
			[
				{ title: "alpha", path: "alpha.md" },
				{ title: "beta", path: "beta.md" },
			],
			[{ from: "alpha.md", to: "beta.md" }],
		);
		expect(graphStats.node_count).toBe(2);
		const ranked = wasm.graph_rank_candidates(["alpha"], [
			{ title: "alpha", path: "alpha.md" },
			{ title: "beta", path: "beta.md" },
		]);
		expect(ranked[0].path).toBe("alpha.md");
		expect(ranked[1].path).toBe("beta.md");
	});
});
