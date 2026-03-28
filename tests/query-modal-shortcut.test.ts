import { describe, expect, it, vi } from "vitest";

import { GraphQueryModal } from "../ui/query-modal";

type ModalShortcutHarness = {
	handleKeydown: (event: {
		key: string;
		ctrlKey?: boolean;
		metaKey?: boolean;
		preventDefault: () => void;
	}) => void;
	insertSelectedResultAsNear: () => void;
	openSelectedResult: () => void;
	moveSelection: (delta: number) => void;
	close: () => void;
	results: { path: string }[];
	selectedIndex: number;
	inputController?: {
		insertChipAfterLastChip: (
			kind: string,
			value: string,
			display?: string,
		) => void;
	};
	plugin: {
		getDisplayTitle: (path: string) => string;
	};
};

function createHarness(): ModalShortcutHarness {
	return {
		handleKeydown: (
			GraphQueryModal.prototype as unknown as ModalShortcutHarness
		).handleKeydown,
		insertSelectedResultAsNear: (
			GraphQueryModal.prototype as unknown as ModalShortcutHarness
		).insertSelectedResultAsNear,
		openSelectedResult: vi.fn(),
		moveSelection: vi.fn(),
		close: vi.fn(),
		results: [],
		selectedIndex: -1,
		plugin: {
			getDisplayTitle: vi.fn((path: string) => path),
		},
	};
}

describe("GraphQueryModal keyboard shortcuts", () => {
	it("opens the selected result on Enter", () => {
		const modal = createHarness();
		const preventDefault = vi.fn();

		modal.handleKeydown({ key: "Enter", preventDefault });

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(modal.openSelectedResult).toHaveBeenCalledOnce();
	});

	it("adds the selected result as near on Ctrl+Enter", () => {
		const modal = createHarness();
		const preventDefault = vi.fn();
		modal.results = [{ path: "notes/alpha.md" }];
		modal.selectedIndex = 0;
		modal.inputController = {
			insertChipAfterLastChip: vi.fn(),
		};
		modal.plugin.getDisplayTitle = vi.fn(() => "alpha");

		modal.handleKeydown({ key: "Enter", ctrlKey: true, preventDefault });

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(modal.openSelectedResult).not.toHaveBeenCalled();
		expect(
			modal.inputController.insertChipAfterLastChip,
		).toHaveBeenCalledWith("near", "notes/alpha.md", "alpha");
	});

	it("adds the selected result as near on Cmd+Enter", () => {
		const modal = createHarness();
		modal.results = [{ path: "notes/beta.md" }];
		modal.selectedIndex = 0;
		modal.inputController = {
			insertChipAfterLastChip: vi.fn(),
		};
		modal.plugin.getDisplayTitle = vi.fn(() => "beta");

		modal.handleKeydown({
			key: "Enter",
			metaKey: true,
			preventDefault: vi.fn(),
		});

		expect(
			modal.inputController.insertChipAfterLastChip,
		).toHaveBeenCalledWith("near", "notes/beta.md", "beta");
	});

	it("does nothing on Ctrl+Enter when there is no selection", () => {
		const modal = createHarness();
		modal.inputController = {
			insertChipAfterLastChip: vi.fn(),
		};

		modal.handleKeydown({
			key: "Enter",
			ctrlKey: true,
			preventDefault: vi.fn(),
		});

		expect(
			modal.inputController.insertChipAfterLastChip,
		).not.toHaveBeenCalled();
		expect(modal.openSelectedResult).not.toHaveBeenCalled();
	});
});
