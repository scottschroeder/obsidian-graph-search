import { App, FuzzySuggestModal } from "obsidian";

import { buildDanglingGraphInput, stripMdExtension } from "./link-utils";
import { collectFileAliases } from "./metadata/aliases";

type NoteTitleItem = {
	title: string;
	path: string;
	value: string;
	display: string;
	label: string;
};

export function openTitlePicker(
	app: App,
	onSelect: (value: string, display: string) => void,
	onCancel?: () => void,
) {
	const modal = new NoteTitleSuggestModal(app, onSelect, onCancel);
	modal.open();
}

class NoteTitleSuggestModal extends FuzzySuggestModal<NoteTitleItem> {
	private onSelect: (value: string, display: string) => void;
	private onCancel?: () => void;
	private items: NoteTitleItem[];
	private submitted = false;

	constructor(
		app: App,
		onSelect: (value: string, display: string) => void,
		onCancel?: () => void,
	) {
		super(app);
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.items = buildNoteTitleItems(app);
		this.setPlaceholder("Type a note title");
	}

	getItems(): NoteTitleItem[] {
		return this.items;
	}

	getItemText(item: NoteTitleItem): string {
		return item.label;
	}

	onChooseItem(item: NoteTitleItem, _evt: MouseEvent | KeyboardEvent): void {
		this.submitted = true;
		this.onSelect(item.value, item.display);
	}

	onClose(): void {
		super.onClose();
		if (!this.submitted && this.onCancel) {
			this.onCancel();
		}
	}
}

export function buildNoteTitleItems(app: App): NoteTitleItem[] {
	const files = app.vault.getMarkdownFiles();
	const counts = new Map<string, number>();

	files.forEach((file) => {
		counts.set(file.basename, (counts.get(file.basename) ?? 0) + 1);
	});

	const items = files.flatMap((file) => {
		const hasDuplicate = (counts.get(file.basename) ?? 0) > 1;
		const value = file.path;
		const display = hasDuplicate
			? stripMdExtension(file.path)
			: file.basename;
		const titleLabel = hasDuplicate
			? `${file.basename} - ${stripMdExtension(file.path)}`
			: file.basename;
		const itemsForFile: NoteTitleItem[] = [
			{
				title: file.basename,
				path: file.path,
				value,
				display,
				label: titleLabel,
			},
		];
		const seenLabels = new Set(
			[
				titleLabel,
				file.basename,
				display,
				file.path,
				stripMdExtension(file.path),
			].map((value) => value.toLocaleLowerCase()),
		);
		for (const alias of collectFileAliases(app, file)) {
			const aliasKey = alias.toLocaleLowerCase();
			if (seenLabels.has(aliasKey)) {
				continue;
			}
			seenLabels.add(aliasKey);
			itemsForFile.push({
				title: file.basename,
				path: file.path,
				value,
				display: alias,
				label: `${alias} -> ${display}`,
			});
		}
		return itemsForFile;
	});

	const dangling = buildDanglingGraphInput({
		unresolvedLinks: app.metadataCache.unresolvedLinks,
		existingPaths: files.map((file) => file.path),
		existingTitles: files.map((file) => file.basename),
	});
	for (const node of dangling.nodes) {
		const display = node.path.startsWith("__dangling__/")
			? node.path.slice("__dangling__/".length)
			: node.path;
		items.push({
			title: display,
			path: node.path,
			value: node.path,
			display,
			label: `${display} (not created)`,
		});
	}

	return items;
}
