import { App, FuzzySuggestModal } from "obsidian";

type FilterItem = {
	value: "near" | "near-current" | "tag" | "path" | "literal";
	label: string;
};

export function openFilterPicker(
	app: App,
	onSelect: (value: FilterItem["value"]) => void,
	onCancel?: () => void,
) {
	const modal = new FilterSuggestModal(app, onSelect, onCancel);
	modal.open();
}

class FilterSuggestModal extends FuzzySuggestModal<FilterItem> {
	private onSelect: (value: FilterItem["value"]) => void;
	private onCancel?: () => void;
	private items: FilterItem[];
	private submitted = false;

	constructor(
		app: App,
		onSelect: (value: FilterItem["value"]) => void,
		onCancel?: () => void,
	) {
		super(app);
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.items = buildFilterItems(app);
		this.setPlaceholder("Filter by near, tag, path");
	}

	getItems(): FilterItem[] {
		return this.items;
	}

	getItemText(item: FilterItem): string {
		return item.label;
	}

	onChooseItem(item: FilterItem, _evt: MouseEvent | KeyboardEvent): void {
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

function buildFilterItems(app: App): FilterItem[] {
	const items: FilterItem[] = [
		{ value: "near", label: "near" },
		{ value: "tag", label: "tag" },
		{ value: "path", label: "path" },
	];
	const activeFile = app.workspace.getActiveFile();
	if (activeFile) {
		items.push({
			value: "near-current",
			label: `near: current note (${activeFile.basename})`,
		});
	}
	items.push({ value: "literal", label: ": (literal)" });
	return items;
}
