export {};

declare module "../../pkg/obsidian_rust_plugin" {
	export function cleanup_all(): null;
	export function graph_init(
		nodes: import("./link-utils").GraphNodeInput[],
		edges: import("./link-utils").GraphEdgeInput[],
	): null;
	export function graph_query_from_atoms(
		atoms: import("./types").QueryAtom[],
		weights: import("./types").ScoreWeights,
	): import("./types").GraphQueryResult;
	export function search_index(
		docs: import("./types").SearchDocumentInput[],
	): null;
}
