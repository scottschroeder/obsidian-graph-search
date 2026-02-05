# Graph Search for Obsidian

Search and rank notes by graph link proximity combined with title and body relevance. Use it when plain search returns too many hits and you want results related to specific notes or people.

## Why you might want this

- Rank matches by graph proximity to one or more "near" notes.
- Combine text search with tags and paths while still honoring graph distance.
- Fine-tune scoring weights and falloff to match your vault.

## How to use

1. Enable the plugin in Obsidian.
2. Run the command `Graph query` (Command Palette).
3. Type a query and press Enter.

## Query syntax

- Plain terms: `budget`
- Filters: type `:` to open a chip selector dialog for filter chips `near`, `tag`, or `path`

```
budget q3 [near: Bob] [tag: #meeting]
```

This will search for notes that have the word "budget" and the tag `#meeting`. So far that's just a pretty normal search plugin. The neat part is the `near` option, which will score results based on how close they are in your graph to a note `Bob.md`.

This works with multiple notes too, so you could combine `[near: Books] [near: Brian]` to find that book Brian recommended to you.

## Scoring behavior

The farther a note is in the graph, the lower its score. Also, notes with a lot of links will reduce the score more than a note with only a few links. This prevents a note like `2026.md` with hundreds of links from connecting everything and drowning out meaningful links.

## Debug mode

- Settings → Graph Search → Advanced scoring → Debug mode
- When enabled, previews show distance/title/body/total score breakdowns and the status line.

## Areas for Improvement

- Right now the search functionality is fairly basic, and the search weights are just numbers that "felt right". I think a lot more could be done here to bring search up to par.
- The index/graph are built from scratch every time the search modal is opened. On my vault(s) this is imperceptibly fast and avoids any issues with old data. There is probably a design where we incrementally update the index/graphs as changes are made which would be more efficient, if more complex. Practically this only makes sense if we encounter a vault large enough that the indexing delay becomes noticable or inconvenient.

# Development

> [!NOTE]
> AI Disclaimer: A lot of the frontend/TypeScript is AI generated (I promise it would be worse if I wrote it). I used some AI tools for the Rust backend too, but that code was much more carefully written and reviewed.

## Known limitations

- Tag collection uses Obsidian's internal `getTags()` API which may change in future versions.

## Development Environment

### Prerequisites

- Rust + cargo (via `rustup`)
- `wasm-pack`
- `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- Node.js + npm

### Common commands

- `make install` (build and copy to your vault)
- `VAULT_DIR=~/Documents/notes PLUGIN_ID=graph-search make install`
- `make test`

## Release

1. Bump versions to `X.Y.Z`:
    ```bash
    cargo run --package xtask -- version bump X.Y.Z
    ```
2. Re-run build to generate updated assets
    ```bash
    make build
    ```
3. Commit & push updated assets
4. Tag the release with `X.Y.Z` (no `v` prefix) and push the tag.
    ```bash
    git tag -s 0.4.2 -m ''
    git push origin --tags
    ```
5. The GitHub Actions workflow will build and create a draft release when the tag matches `X.Y.Z` and `manifest.json`.

Notes:

- `manifest.json`, `package.json`, and `Cargo.toml` must match exactly.
- `versions.json` must include the release version with the current `minAppVersion`.
