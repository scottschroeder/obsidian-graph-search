import * as wasm from "../../../pkg/obsidian_rust_plugin";

import type { GraphQueryResult, QueryAtom } from "../types";
import type { GraphSearchPluginApi } from "./plugin-api";

export class GraphQueryEngine {
	private plugin: GraphSearchPluginApi;
	private graphReady = false;
	private searchReady = false;
	private buildPromise?: Promise<void>;
	private closed = false;

	constructor(plugin: GraphSearchPluginApi) {
		this.plugin = plugin;
	}

	startBuild(): Promise<void> | undefined {
		if (this.buildPromise) {
			return this.buildPromise;
		}
		this.buildPromise = this.buildIndexes().finally(() => {
			this.buildPromise = undefined;
		});
		return this.buildPromise;
	}

	async query(atoms: QueryAtom[]): Promise<GraphQueryResult> {
		await this.ensureReady();
		return (await wasm.graph_query_from_atoms(
			atoms,
			this.plugin.getScoreWeights(),
		)) as GraphQueryResult;
	}

	dispose() {
		this.closed = true;
		this.plugin.clearIndexes();
	}

	private async ensureReady() {
		if (this.buildPromise) {
			await this.buildPromise;
		}
		if (!this.graphReady) {
			await this.plugin.buildGraphIndex();
			this.graphReady = true;
		}
		if (!this.searchReady) {
			await this.plugin.buildSearchIndex();
			this.searchReady = true;
		}
	}

	private async buildIndexes() {
		try {
			await this.plugin.buildGraphIndex();
			if (this.closed) {
				return;
			}
			this.graphReady = true;
			await this.plugin.buildSearchIndex();
			if (this.closed) {
				return;
			}
			this.searchReady = true;
		} finally {
			if (this.closed) {
				this.plugin.clearIndexes();
			}
		}
	}
}
