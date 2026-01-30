export function collectFrontmatterTags(value: unknown): string[] {
	if (typeof value === "string") {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry));
	}
	return [];
}

export function splitTagString(value: string): string[] {
	if (value.includes(",")) {
		return value.split(",");
	}
	return value.split(/\s+/);
}
