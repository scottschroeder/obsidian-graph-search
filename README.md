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
- Node.js + yarn

### Common commands

- `make install` (build and copy to your vault)
- `VAULT_DIR=~/Documents/notes PLUGIN_ID=graph-search make install`
- `make test`
