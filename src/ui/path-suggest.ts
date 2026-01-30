import { App, FuzzySuggestModal, TFolder } from "obsidian";

type PathItem = {
	value: string;
	label: string;
};

export function openPathPicker(
	app: App,
	onSelect: (value: string) => void,
	onCancel?: () => void,
) {
	const modal = new PathSuggestModal(app, onSelect, onCancel);
	modal.open();
}

class PathSuggestModal extends FuzzySuggestModal<PathItem> {
	private onSelect: (value: string) => void;
	private onCancel?: () => void;
	private items: PathItem[];
	private submitted = false;

	constructor(
		app: App,
		onSelect: (value: string) => void,
		onCancel?: () => void,
	) {
		super(app);
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.items = buildFolderItems(app);
		this.setPlaceholder("Type a folder path");
	}

	getItems(): PathItem[] {
		return this.items;
	}

	getItemText(item: PathItem): string {
		return item.label;
	}

	onChooseItem(item: PathItem, _evt: MouseEvent | KeyboardEvent): void {
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

function buildFolderItems(app: App): PathItem[] {
	const items = app.vault
		.getAllLoadedFiles()
		.filter((file): file is TFolder => file instanceof TFolder)
		.map((folder) => ({
			value: folder.path,
			label: folder.path || "/",
		}));

	items.sort((a, b) => a.label.localeCompare(b.label));
	return items;
}
