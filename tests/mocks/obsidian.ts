type MockElement = HTMLElement & {
	empty(): void;
	setText(text: string): void;
	show(): void;
	hide(): void;
	setCssProps(props: Record<string, string>): void;
};

type MockDomElementInfo = {
	cls?: string | string[];
	text?: string | DocumentFragment;
	attr?: Record<string, string | number | boolean | null>;
	title?: string;
	parent?: Node;
	value?: string;
	type?: string;
	prepend?: boolean;
	placeholder?: string;
	href?: string;
};

function applyElementInfo<T extends HTMLElement>(
	element: T,
	info?: MockDomElementInfo | string,
	callback?: (el: T) => void,
): T {
	if (typeof info === "string") {
		element.textContent = info;
	} else if (info) {
		if (info.text) {
			element.replaceChildren(info.text);
		}
		if (info.cls) {
			element.className = Array.isArray(info.cls)
				? info.cls.join(" ")
				: info.cls;
		}
		if (info.title) {
			element.title = info.title;
		}
		if (info.value !== undefined) {
			element.setAttribute("value", info.value);
		}
		if (info.type) {
			element.setAttribute("type", info.type);
		}
		if (info.placeholder) {
			element.setAttribute("placeholder", info.placeholder);
		}
		if (info.href) {
			element.setAttribute("href", info.href);
		}
		if (info.attr) {
			Object.entries(info.attr).forEach(([name, value]) => {
				element.setAttribute(name, value === null ? "" : String(value));
			});
		}
	}
	callback?.(element);
	return element;
}

function decorateElement<T extends HTMLElement>(element: T): T & MockElement {
	const decorated = element as T & MockElement;
	decorated.empty = () => {
		decorated.replaceChildren();
	};
	decorated.setText = (text: string) => {
		decorated.textContent = text;
	};
	decorated.setCssProps = (props: Record<string, string>) => {
		Object.entries(props).forEach(([name, value]) => {
			decorated.style.setProperty(name, value);
		});
	};
	decorated.show = () => {
		decorated.setCssProps({ display: "" });
	};
	decorated.hide = () => {
		decorated.setCssProps({ display: "none" });
	};
	decorated.createEl = <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		options?: MockDomElementInfo | string,
		callback?: (el: HTMLElementTagNameMap[K]) => void,
	) => {
		const child = document.createElement(tag);
		decorated.appendChild(child);
		return applyElementInfo(child, options, callback);
	};
	decorated.createDiv = (
		options?: MockDomElementInfo | string,
		callback?: (el: HTMLDivElement) => void,
	) => {
		const child = document.createElement("div");
		decorated.appendChild(child);
		return applyElementInfo(child, options, callback);
	};
	return decorated;
}

export const Platform = {
	isMacOS: false,
};

export class App {
	workspace = {
		getActiveFile: () => null,
		getLeaf: () => ({
			openFile: async () => undefined,
		}),
	};
	vault = {
		getMarkdownFiles: () => [],
		getAllLoadedFiles: () => [],
		getAbstractFileByPath: () => null,
		cachedRead: async () => "",
	};
	metadataCache = {
		getFileCache: () => null,
		resolvedLinks: {},
		unresolvedLinks: {},
	};
}

export class Modal {
	app: App;
	contentEl: MockElement;
	modalEl: MockElement;

	constructor(app: App) {
		this.app = app;
		this.contentEl = decorateElement(document.createElement("div"));
		this.modalEl = decorateElement(document.createElement("div"));
	}

	open() {
		this.onOpen();
	}

	close() {
		this.onClose();
	}

	onOpen() {}

	onClose() {}
}

export class FuzzySuggestModal<T> extends Modal {
	setPlaceholder(_placeholder: string) {}

	getItems(): T[] {
		return [];
	}

	getItemText(_item: T): string {
		return "";
	}

	onChooseItem(_item: T, _evt: MouseEvent | KeyboardEvent): void {}
}

export class Notice {
	message: string;

	constructor(message: string) {
		this.message = message;
	}
}

export class TFile {
	path: string;
	basename: string;

	constructor(path = "", basename = "") {
		this.path = path;
		this.basename = basename;
	}
}

export class TFolder {
	path: string;

	constructor(path = "") {
		this.path = path;
	}
}

export class Plugin {
	app: App;

	constructor(app: App) {
		this.app = app;
	}

	addCommand(_command: unknown) {}

	addSettingTab(_tab: unknown) {}

	async loadData() {
		return {};
	}

	async saveData(_data: unknown) {}
}

export class Setting {
	constructor(_containerEl: HTMLElement) {}

	setName(_name: string) {
		return this;
	}

	setHeading() {
		return this;
	}
}
