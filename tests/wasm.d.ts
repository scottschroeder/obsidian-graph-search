export {};

declare module "../pkg/obsidian_rust_plugin.js" {
	export function cleanup_all(): null;
	export function graph_init(
		nodes: import("../ui/link-utils").GraphNodeInput[],
		edges: import("../ui/link-utils").GraphEdgeInput[],
	): null;
	export function graph_query_from_atoms(
		atoms: import("../ui/types").QueryAtom[],
		weights: import("../ui/types").ScoreWeights,
	): import("../ui/types").GraphQueryResult;
	export function search_index(
		docs: import("../ui/types").SearchDocumentInput[],
	): null;
	export function initSync(
		module:
			| { module: import("../pkg/obsidian_rust_plugin.js").SyncInitInput }
			| import("../pkg/obsidian_rust_plugin.js").SyncInitInput,
	): import("../pkg/obsidian_rust_plugin.js").InitOutput;
}
