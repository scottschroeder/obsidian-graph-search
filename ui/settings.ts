import type { Plugin } from "obsidian";
import { App, PluginSettingTab, Setting } from "obsidian";

export interface GraphSearchPluginSettings {
	scoreWeightDistance: number;
	scoreWeightTitle: number;
	scoreWeightBody: number;
	scoreDistanceFalloff: number;
	scoreConnectionStrength: number;
	scoreDistanceCurve: string;
	debugMode: boolean;
}

export const DEFAULT_SETTINGS: GraphSearchPluginSettings = {
	scoreWeightDistance: 5.0,
	scoreWeightTitle: 3.0,
	scoreWeightBody: 1.0,
	scoreDistanceFalloff: 0.1,
	scoreConnectionStrength: 0.9,
	scoreDistanceCurve: "exponential",
	debugMode: false,
};

type GraphSearchSettingsOwner = Plugin & {
	settings: GraphSearchPluginSettings;
	saveSettings(): Promise<void>;
};

export class GraphSearchSettingTab extends PluginSettingTab {
	plugin: GraphSearchSettingsOwner;

	constructor(app: App, plugin: GraphSearchSettingsOwner) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Reset scoring defaults")
			.setDesc("Restore all scoring settings to the built-in defaults")
			.addButton((button) =>
				button.setButtonText("Reset").onClick(async () => {
					this.plugin.settings = { ...DEFAULT_SETTINGS };
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc("Show scoring breakdown in result previews")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Distance weight")
			.setDesc(
				`How much graph distance contributes to score (default ${DEFAULT_SETTINGS.scoreWeightDistance})`,
			)
			.addText((text) =>
				text
					.setPlaceholder(
						String(DEFAULT_SETTINGS.scoreWeightDistance),
					)
					.setValue(String(this.plugin.settings.scoreWeightDistance))
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreWeightDistance = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Title match weight")
			.setDesc(
				`How much title matches contribute to score (default ${DEFAULT_SETTINGS.scoreWeightTitle})`,
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.scoreWeightTitle))
					.setValue(String(this.plugin.settings.scoreWeightTitle))
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreWeightTitle = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Body match weight")
			.setDesc(
				`How much body matches contribute to score (default ${DEFAULT_SETTINGS.scoreWeightBody})`,
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.scoreWeightBody))
					.setValue(String(this.plugin.settings.scoreWeightBody))
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreWeightBody = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Distance falloff")
			.setDesc(
				`Controls how quickly distance score drops after 1-hop (default ${DEFAULT_SETTINGS.scoreDistanceFalloff})`,
			)
			.addText((text) =>
				text
					.setPlaceholder(
						String(DEFAULT_SETTINGS.scoreDistanceFalloff),
					)
					.setValue(String(this.plugin.settings.scoreDistanceFalloff))
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreDistanceFalloff = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Distance curve")
			.setDesc(
				`How distance scores decay across hops (default ${DEFAULT_SETTINGS.scoreDistanceCurve})`,
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("exponential", "Exponential")
					.addOption("reciprocal", "Reciprocal")
					.addOption("power", "Power")
					.setValue(this.plugin.settings.scoreDistanceCurve)
					.onChange(async (value) => {
						this.plugin.settings.scoreDistanceCurve = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Connection strength")
			.setDesc(
				`Penalizes paths that pass through high-degree notes (0 disables, default ${DEFAULT_SETTINGS.scoreConnectionStrength})`,
			)
			.addText((text) =>
				text
					.setPlaceholder(
						String(DEFAULT_SETTINGS.scoreConnectionStrength),
					)
					.setValue(
						String(this.plugin.settings.scoreConnectionStrength),
					)
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (!Number.isNaN(parsed)) {
							this.plugin.settings.scoreConnectionStrength =
								parsed;
							await this.plugin.saveSettings();
						}
					}),
			);
	}
}
