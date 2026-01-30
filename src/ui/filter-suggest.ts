import { App, FuzzySuggestModal } from "obsidian";

type FilterItem = {
	value: "near" | "tag" | "path" | "literal";
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
	private submitted = false;

	constructor(
		app: App,
		onSelect: (value: FilterItem["value"]) => void,
		onCancel?: () => void,
	) {
		super(app);
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.setPlaceholder("Filter: near, tag, path");
	}

	getItems(): FilterItem[] {
		return [
			{ value: "literal", label: ": (literal)" },
			{ value: "near", label: "near" },
			{ value: "tag", label: "tag" },
			{ value: "path", label: "path" },
		];
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
