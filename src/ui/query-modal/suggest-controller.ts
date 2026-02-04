import type { App } from "obsidian";

import type { QueryAtom } from "../types";
import { formatTagValue } from "../query-utils";
import { openFilterPicker } from "../filter-suggest";
import { openPathPicker } from "../path-suggest";
import { openTitlePicker } from "../title-suggest";
import { openTagPicker } from "../tag-suggest";
import type { GraphSearchPluginApi } from "./plugin-api";

type InsertChipHandler = (
	kind: QueryAtom["kind"],
	value: string,
	caret: number,
	display?: string,
) => void;

export class QuerySuggestController {
	private app: App;
	private plugin: GraphSearchPluginApi;
	private onInsertChip: InsertChipHandler;
	private isSuggesting = false;

	constructor(
		app: App,
		plugin: GraphSearchPluginApi,
		onInsertChip: InsertChipHandler,
	) {
		this.app = app;
		this.plugin = plugin;
		this.onInsertChip = onInsertChip;
	}

	get suggesting(): boolean {
		return this.isSuggesting;
	}

	openFilterSuggest(caret: number) {
		if (this.isSuggesting) {
			return;
		}
		this.isSuggesting = true;
		openFilterPicker(
			this.app,
			(selected) => {
				this.isSuggesting = false;
				if (selected === "literal") {
					return;
				}
				if (selected === "near-current") {
					const activeFile = this.app.workspace.getActiveFile();
					if (activeFile) {
						const display = this.plugin.getDisplayTitle(
							activeFile.path,
						);
						this.onInsertChip(
							"near",
							activeFile.path,
							caret,
							display,
						);
					}
					return;
				}
				if (selected === "near") {
					this.isSuggesting = true;
					openTitlePicker(
						this.app,
						(path, display) => {
							this.onInsertChip("near", path, caret, display);
						},
						() => {
							this.isSuggesting = false;
						},
					);
					return;
				}
				if (selected === "tag") {
					this.isSuggesting = true;
					openTagPicker(
						this.app,
						(value) => {
							const formatted = formatTagValue(value);
							this.onInsertChip("tag", formatted, caret);
						},
						() => {
							this.isSuggesting = false;
						},
					);
					return;
				}
				if (selected === "path") {
					this.isSuggesting = true;
					openPathPicker(
						this.app,
						(value) => {
							this.onInsertChip("path", value, caret);
						},
						() => {
							this.isSuggesting = false;
						},
					);
				}
			},
			() => {
				this.isSuggesting = false;
			},
		);
	}
}
