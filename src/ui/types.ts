export type GraphStats = {
	node_count: number;
	edge_count: number;
};

export type ParsedQuery = {
	near_titles: string[];
	base_query: string;
};

export type CandidateInput = {
	title: string;
	path: string;
};

export type ScoredCandidate = {
	title: string;
	path: string;
	distance_sum: number;
};

export type SearchDocumentInput = {
	title: string;
	path: string;
	body: string;
};

export type SearchStats = {
	doc_count: number;
	token_count: number;
};

export type DistanceEntry = {
	title: string;
	path: string;
	distance: number | null;
};
