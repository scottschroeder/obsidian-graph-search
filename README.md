# Graph Search for Obsidian

Search and rank notes by graph link proximity combined with title and body relevance. Use it when plain search returns too many hits and you want results related to specific notes or people.

## Why you might want this

- Rank matches by graph proximity to one or more "near" notes.
- Combine text search with tags and paths while still honoring graph distance.
- Fine-tune scoring weights and falloff to match your vault.

## How to use

1. Enable the plugin in Obsidian.
2. Run the command `Graph search`.
3. Type a query and press Enter.

## Query syntax

- Plain terms: `budget q3`
- Filters: type `:` to insert chips for near, tag, or path

### Example

```
budget [near: Bob] [tag: #meeting]
```

## Scoring behavior

- Results must match tag/path filters.
- When near chips are used, only notes connected in the graph are included.
- Distance 0 and 1 are weighted equally; deeper hops decay exponentially by `distanceFalloff`.
- Total score = distance + title + body (weights applied in settings).

## Debug mode

- Settings → Graph Search → Advanced Scoring → Debug mode
- When enabled, previews show distance/title/body/total score breakdowns and the status line.

## Known limitations

- Tag collection uses Obsidian's internal `getTags()` API which may change in future versions.

## Development environment setup

### Prerequisites

- Rust + cargo (via `rustup`)
- `wasm-pack`
- `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- Node.js + yarn

### Common commands

- `make install` (build and copy to your vault)
- `VAULT_DIR=~/Documents/notes PLUGIN_ID=graph-search make install`
- `make test`
