import path from "node:path";
import { fileURLToPath } from "node:url";
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
		rules: {
			"no-unused-vars": "off",
			"no-prototype-builtins": "off",
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
		rules: {
			"@typescript-eslint/no-deprecated": "off",
		},
	},
	{
		files: ["tests/**/*.ts", "tests/**/*.tsx"],
		languageOptions: {
			globals: {
				process: "readonly",
			},
		},
		rules: {
			"import/no-nodejs-modules": "off",
		},
	},
	{
		files: ["package.json"],
		rules: {
			"depend/ban-dependencies": "off",
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
		rules: {
			"@typescript-eslint/no-unused-vars": ["warn", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/no-empty-function": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unnecessary-type-assertion": "off",
			"@typescript-eslint/no-floating-promises": "off",
		},
	},
];
