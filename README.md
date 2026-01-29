# Obsidian Sample Plugin (Rust)

This is a quick proof of concept combining the current [Obsidian Git template](https://github.com/obsidianmd/obsidian-sample-plugin) and an [earlier proof-of-concept](https://github.com/trashhalo/obsidian-rust-plugin). Thanks to @trashhalo who essentially did all the work!

## Prerequisites

- Rust + cargo (via `rustup`)
- `wasm-pack` installed: https://drager.github.io/wasm-pack/
- Node.js + yarn
- Wasm target: `rustup target add wasm32-unknown-unknown`

## Quick start

1. Create a new repo with this one as a template.
2. Install Node dependencies: `yarn install`.
3. Build and install into your vault: `make install`.
4. Reload Obsidian and enable the plugin.

## Quick install to your vault

Use the Makefile to build and copy the plugin into your vault's plugins folder:

```bash
make install
```

Overrides:

```bash
VAULT_DIR=~/Documents/personal PLUGIN_ID=obsidian-sample-plugin make install
```

## Verify in Obsidian

1. Reload Obsidian.
2. Enable the plugin in Settings → Community plugins.
3. Open the command palette and run "Sample Plugin: Example Command".
4. You should see a "hello from rust" notice.

## Make targets

- `make preflight`: verify toolchain availability
- `make deps`: install Node dependencies
- `make wasm`: build the Rust wasm package
- `make build`: wasm + TypeScript build
- `make dev`: watch mode build
- `make install`: build and copy to your vault
- `make lint`: Rust + TypeScript lint
- `make fmt`: Rust + JS/TS format
- `make test`: Rust tests + JS placeholder
- `make clean`: remove build artifacts

## Troubleshooting

- `wasm-pack not found`: install `wasm-pack` and ensure it is on PATH
- `wasm32-unknown-unknown not found`: run `rustup target add wasm32-unknown-unknown`
- `wasm-bindgen` version error: update `wasm-bindgen` in `Cargo.toml`

## Template checklist

- Update `manifest.json` (`id`, `name`, `author`, `description`)
- Update `package.json` (`name`, `description`)
- Rename plugin class in `main.ts`
- Rename repo and adjust `README.md`

The build pipeline compiles Rust to WebAssembly with `wasm-pack`, then bundles the plugin with esbuild. The `main.ts` file loads the generated wasm package from `pkg/`.

To test: run "Sample Plugin: Example Command" from the command palette; you should see a "hello from rust" notice.

I'm leaving the original Obsidian plugin docs below in case it's helpful:

# Obsidian Sample Plugin docs

This is a sample plugin for Obsidian (https://obsidian.md).

This project uses Typescript to provide type checking and documentation.
The repo depends on the latest plugin API (obsidian.d.ts) in Typescript Definition format, which contains TSDoc comments describing what it does.

**Note:** The Obsidian API is still in early alpha and is subject to change at any time!

This sample plugin demonstrates some of the basic functionality the plugin API can do.

- Changes the default font color to red using `styles.css`.
- Adds a ribbon icon, which shows a Notice when clicked.
- Adds a command "Open Sample Modal" which opens a Modal.
- Adds a plugin setting tab to the settings page.
- Registers a global click event and output 'click' to the console.
- Registers a global interval which logs 'setInterval' to the console.

## First time developing plugins?

Quick starting guide for new plugin devs:

- Check if [someone already developed a plugin for what you want](https://obsidian.md/plugins)! There might be an existing plugin similar enough that you can partner up with.
- Make a copy of this repo as a template with the "Use this template" button (login to GitHub if you don't see it).
- Clone your repo to a local development folder. For convenience, you can place this folder in your `.obsidian/plugins/your-plugin-name` folder.
- Install NodeJS, then run `npm i` in the command line under your repo folder.
- Run `npm run dev` to compile your plugin from `main.ts` to `main.js`.
- Make changes to `main.ts` (or create new `.ts` files). Those changes should be automatically compiled into `main.js`.
- Reload Obsidian to load the new version of your plugin.
- Enable plugin in settings window.
- For updates to the Obsidian API run `npm update` in the command line under your repo folder.

## Releasing new releases

- Update your `manifest.json` with your new version number, such as `1.0.1`, and the minimum Obsidian version required for your latest release.
- Update your `versions.json` file with `"new-plugin-version": "minimum-obsidian-version"` so older versions of Obsidian can download an older version of your plugin that's compatible.
- Create new GitHub release using your new version number as the "Tag version". Use the exact version number, don't include a prefix `v`. See here for an example: https://github.com/obsidianmd/obsidian-sample-plugin/releases
- Upload the files `manifest.json`, `main.js`, `styles.css` as binary attachments. Note: The manifest.json file must be in two places, first the root path of your repository and also in the release.
- Publish the release.

> You can simplify the version bump process by running `npm version patch`, `npm version minor` or `npm version major` after updating `minAppVersion` manually in `manifest.json`.
> The command will bump version in `manifest.json` and `package.json`, and add the entry for the new version to `versions.json`

## Adding your plugin to the community plugin list

- Check https://github.com/obsidianmd/obsidian-releases/blob/master/plugin-review.md
- Publish an initial version.
- Make sure you have a `README.md` file in the root of your repo.
- Make a pull request at https://github.com/obsidianmd/obsidian-releases to add your plugin.

## How to use

- Clone this repo.
- `npm i` or `yarn` to install dependencies
- `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## Improve code quality with eslint (optional)

- [ESLint](https://eslint.org/) is a tool that analyzes your code to quickly find problems. You can run ESLint against your plugin to find common bugs and ways to improve your code.
- To use eslint with this project, make sure to install eslint from terminal:
    - `npm install -g eslint`
- To use eslint to analyze this project use this command:
    - `eslint main.ts`
    - eslint will then create a report with suggestions for code improvement by file and line number.
- If your source code is in a folder, such as `src`, you can use eslint with this command to analyze all files in that folder:
    - `eslint .\src\`

## Funding URL

You can include funding URLs where people who use your plugin can financially support it.

The simple way is to set the `fundingUrl` field to your link in your `manifest.json` file:

```json
{
	"fundingUrl": "https://buymeacoffee.com"
}
```

If you have multiple URLs, you can also do:

```json
{
	"fundingUrl": {
		"Buy Me a Coffee": "https://buymeacoffee.com",
		"GitHub Sponsor": "https://github.com/sponsors",
		"Patreon": "https://www.patreon.com/"
	}
}
```

## API Documentation

See https://github.com/obsidianmd/obsidian-api
