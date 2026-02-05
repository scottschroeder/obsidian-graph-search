import path from "node:path";
import { fileURLToPath } from "node:url";
import importPlugin from "eslint-plugin-import";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const flattenConfigs = (configs) => {
	const result = [];

	const applyScope = (config, scope) => {
		if (!scope) {
			return config;
		}

		const scoped = { ...config };

		if (scope.files && !scoped.files) {
			scoped.files = scope.files;
		}

		if (scope.ignores && !scoped.ignores) {
			scoped.ignores = scope.ignores;
		}

		return scoped;
	};

	const addConfig = (config, scope) => {
		if (Array.isArray(config)) {
			config.forEach((entry) => addConfig(entry, scope));
			return;
		}

		if (!config || typeof config !== "object") {
			result.push(config);
			return;
		}

		if (!Object.hasOwn(config, "extends") || !config.extends) {
			result.push(applyScope(config, scope));
			return;
		}

		const { extends: extendedConfigs, ...rest } = config;
		const nextScope = {
			files: rest.files ?? scope?.files,
			ignores: rest.ignores ?? scope?.ignores,
		};

		addConfig(extendedConfigs, nextScope);

		if (Object.keys(rest).length > 0) {
			result.push(rest);
		}
	};

	for (const config of configs) {
		addConfig(config);
	}

	return result;
};

const obsidianRecommended = flattenConfigs(obsidianmd.configs.recommended);

export default [
	{
		ignores: ["npm", "node_modules", "build", "pkg", "main.js"],
	},
	...obsidianRecommended,
	{
		files: ["eslint.config.mjs", "esbuild.config.mjs"],
		plugins: {
			import: importPlugin,
		},
		rules: {
			"import/no-nodejs-modules": [
				"error",
				{
					allow: [
						"node:module",
						"node:path",
						"node:url",
						"path",
						"fs",
						"process",
					],
				},
			],
		},
	},
	{
		files: ["ui/**/*.ts", "ui/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"],
		languageOptions: {
			globals: {
				window: "readonly",
				document: "readonly",
			},
		},
	},
	{
		files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx"],
		plugins: {
			"@typescript-eslint": tseslint.plugin,
		},
		rules: {},
	},
	{
		files: ["tests/**/*.ts", "tests/**/*.tsx"],
		languageOptions: {
			globals: {
				process: "readonly",
			},
		},
		plugins: {
			import: importPlugin,
		},
		rules: {
			"import/no-nodejs-modules": [
				"error",
				{ allow: ["node:fs", "node:path"] },
			],
		},
	},
	{
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: __dirname,
			},
		},
		plugins: {
			"@typescript-eslint": tseslint.plugin,
		},
		rules: {},
	},
];
