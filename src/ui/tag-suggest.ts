import { App, FuzzySuggestModal } from "obsidian";

type TagItem = {
	value: string;
	label: string;
};

export function openTagPicker(
	app: App,
	onSelect: (value: string) => void,
	onCancel?: () => void,
) {
	const modal = new TagSuggestModal(app, onSelect, onCancel);
	modal.open();
}

class TagSuggestModal extends FuzzySuggestModal<TagItem> {
	private onSelect: (value: string) => void;
	private onCancel?: () => void;
	private items: TagItem[];
	private submitted = false;

	constructor(
		app: App,
		onSelect: (value: string) => void,
		onCancel?: () => void,
	) {
		super(app);
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.items = buildTagItems(app);
		this.setPlaceholder("Type a tag");
	}

	getItems(): TagItem[] {
		return this.items;
	}

	getItemText(item: TagItem): string {
		return item.label;
	}

	onChooseItem(item: TagItem, _evt: MouseEvent | KeyboardEvent): void {
		this.submitted = true;
		this.onSelect(item.value);
	}

	onClose(): void {
		super.onClose();
		if (!this.submitted && this.onCancel) {
			this.onCancel();
		}
	}
}

function buildTagItems(app: App): TagItem[] {
	const tags = (app.metadataCache as {
		getTags?: () => Record<string, number>;
	}).getTags?.();
	const entries = Object.entries(tags ?? {}) as [string, number][];
	entries.sort((a, b) => {
		const countDiff = b[1] - a[1];
		if (countDiff !== 0) {
			return countDiff;
		}
		return a[0].localeCompare(b[0]);
	});
	return entries.map(([tag]) => ({
		value: tag,
		label: tag,
	}));
}
