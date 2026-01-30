import { App, Modal } from "obsidian";

import type { DistanceEntry } from "./types";

export class GraphDistancesModal extends Modal {
	private title: string;
	private entries: DistanceEntry[];

	constructor(app: App, title: string, entries: DistanceEntry[]) {
		super(app);
		this.title = title;
		this.entries = entries;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: `Distances from: ${this.title}`,
		});

		const list = contentEl.createEl("ul");
		this.entries.slice(0, 25).forEach((entry) => {
			const label =
				entry.distance == null
					? "unreachable"
					: entry.distance.toString();
			list.createEl("li", {
				text: `${label} - ${entry.title} (${entry.path})`,
			});
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
