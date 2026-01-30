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
		const atoms = [
			{ kind: "term", value: "budget" },
			{ kind: "whitespace", value: " " },
			{ kind: "near", value: "alpha" },
			{ kind: "tag", value: "#meeting" },
		];
		const parsed = wasm.parse_query_atoms(atoms);
		expect(parsed.near_titles).toEqual(["alpha"]);
		expect(parsed.base_query).toBe("budget tag:#meeting");
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
		const ranked = wasm.graph_rank_candidates(
			["alpha"],
			[
				{
					title: "alpha",
					path: "alpha.md",
					title_score: 0,
					body_score: 0,
				},
				{
					title: "beta",
					path: "beta.md",
					title_score: 0,
					body_score: 0,
				},
			],
			{
				distance_weight: 1,
				title_weight: 1,
				body_weight: 1,
				distance_falloff: 0.5,
				connection_strength: 0,
				distance_curve: "exponential",
			},
		);
		expect(ranked.length).toBe(2);
		const distances = new Map(
			ranked.map((entry: { path: string; distance_sum: number }) => [
				entry.path,
				entry.distance_sum,
			]),
		);
		expect(distances.get("alpha.md")).toBeCloseTo(0, 5);
		expect(distances.get("beta.md")).toBeCloseTo(1, 5);
	});
});
