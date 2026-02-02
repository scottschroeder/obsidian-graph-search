export type GraphNodeInput = {
	title: string;
	path: string;
};

export type GraphEdgeInput = {
	from: string;
	to: string;
};

export function stripMdExtension(value: string): string {
	return value.toLowerCase().endsWith(".md") ? value.slice(0, -3) : value;
}

export function normalizeLinkTarget(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	const [beforeAlias] = trimmed.split("|");
	const withoutAlias = beforeAlias?.trim() ?? "";
	if (!withoutAlias) {
		return "";
	}
	const hashIndex = withoutAlias.indexOf("#");
	const caretIndex = withoutAlias.indexOf("^");
	let endIndex = withoutAlias.length;
	if (hashIndex >= 0) {
		endIndex = Math.min(endIndex, hashIndex);
	}
	if (caretIndex >= 0) {
		endIndex = Math.min(endIndex, caretIndex);
	}
	const withoutSubpath = withoutAlias.slice(0, endIndex).trim();
	if (!withoutSubpath) {
		return "";
	}
	return stripMdExtension(withoutSubpath);
}

export function normalizeLinkKey(value: string): string {
	return value.trim();
}

type BuildDanglingInput = {
	unresolvedLinks: Record<string, Record<string, number>>;
	existingPaths: string[];
	existingTitles: string[];
	pathPrefix?: string;
};

export function buildDanglingGraphInput(input: BuildDanglingInput): {
	nodes: GraphNodeInput[];
	edges: GraphEdgeInput[];
} {
	const {
		unresolvedLinks,
		existingPaths,
		existingTitles,
		pathPrefix = "__dangling__/",
	} = input;
	const existingPathKeys = new Set(
		existingPaths.map((path) => normalizeLinkKey(stripMdExtension(path))),
	);
	const existingTitleKeys = new Set(
		existingTitles.map((title) => normalizeLinkKey(title)),
	);
	const nodes: GraphNodeInput[] = [];
	const edges: GraphEdgeInput[] = [];
	const seenNodes = new Set<string>();
	const seenEdges = new Set<string>();

	for (const [fromPath, targets] of Object.entries(unresolvedLinks)) {
		for (const rawTarget of Object.keys(targets)) {
			const cleaned = normalizeLinkTarget(rawTarget);
			if (!cleaned) {
				continue;
			}
			const key = normalizeLinkKey(cleaned);
			if (existingPathKeys.has(key) || existingTitleKeys.has(key)) {
				continue;
			}
			const syntheticPath = `${pathPrefix}${cleaned}`;
			if (!seenNodes.has(syntheticPath)) {
				seenNodes.add(syntheticPath);
				nodes.push({ title: cleaned, path: syntheticPath });
			}
			const edgeKey = `${fromPath}::${syntheticPath}`;
			if (!seenEdges.has(edgeKey)) {
				seenEdges.add(edgeKey);
				edges.push({ from: fromPath, to: syntheticPath });
			}
		}
	}

	return { nodes, edges };
}
