# Sentence Chunker

A lightweight, dependency-free text chunker for RAG / vector-DB ingestion pipelines. It splits text into sentence-aware chunks that target a token budget, with configurable sentence overlap and a tiered "oversize rescue" cascade for hard-to-split text.

## Highlights

- **Sentence-aware** splitting via `Intl.Segmenter` (with a regex fallback)
- **Token-budgeted** chunks with an approximate, dependency-free token estimator
- **Configurable overlap** between consecutive chunks (in sentences)
- **Tiered oversize cascade**: escalate through increasingly aggressive separators until a chunk fits
- **Configurable separators** with named presets, custom regex, or custom functions
- **Defensive input handling** (non-string input is coerced; empty input returns `[]`)

## Quick start

```js
import chunker from "./chunker.js";

const chunks = await chunker.chunk("Your long document text goes here...");
console.log(chunks);
```

Each chunk has the shape:

```js
{
  text: "…chunk text…",
  metadata: {
    chunkIndex: 0,        // sequential index across the returned array
    tokenEstimate: 123,   // approximate token count
    sentenceCount: 4      // number of sentences in the chunk
  }
}
```

## API

The module has a default export (a ready-to-use chunker) plus two named exports.

### `default` — `chunker`

A preconfigured chunker instance using the defaults.

```js
import chunker from "./chunker.js";
await chunker.chunk(text, flags?);
```

### `createChunker(baseOptions?)`

Creates a chunker with baked-in defaults. Per-call `flags` override the base options.

```js
import { createChunker } from "./chunker.js";

const md = createChunker({ targetTokens: 300, overlapSentences: 2 });
await md.chunk(text);                       // uses base options
await md.chunk(text, { targetTokens: 800 }); // override per call
```

### `SEPARATORS`

Built-in separator presets for the oversize-rescue cascade (see below).

```js
import { SEPARATORS } from "./chunker.js";
```

### `chunk(text, flags?)`

Returns `Promise<Array<{ text, metadata }>>`.

## Options / flags

All options can be set as `baseOptions` in `createChunker(...)` or passed per call as `flags` to `chunk(...)`. Per-call flags win.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `targetTokens` | number | `500` | Desired chunk size. Sentences accumulate until adding another would exceed this. |
| `maxChunkTokens` | number | `targetTokens * 2` | Hard ceiling. Chunks above this trigger the oversize cascade. |
| `overlapSentences` | number | `1` | Number of trailing sentences carried into the next chunk. `0` disables overlap. |
| `locale` | string | `"en"` | Locale used by `Intl.Segmenter`. |
| `useIntlSegmenter` | boolean | `true` | Toggle `Intl.Segmenter`; when `false`, uses the regex fallback splitter. |
| `separators` | Array | `["sentence", "newline"]` | Ordered oversize-rescue cascade (see below). |

## How chunking works

1. **Primary split** — the text is split into sentences:
   - `Intl.Segmenter` (sentence granularity) when available, else
   - a regex fallback: split on whitespace following `.?!;` (punctuation preserved).
2. **Accumulate** — sentences are packed into a chunk until adding the next would exceed `targetTokens`.
3. **Overlap** — when a chunk is flushed, the last `overlapSentences` sentence(s) seed the next chunk for continuity.
4. **Oversize rescue** — any chunk still above `maxChunkTokens` (e.g., a single very long sentence) is recursively re-split using the `separators` cascade.
5. **Re-index** — the final array is re-indexed so `metadata.chunkIndex` is sequential.

## The separators cascade

`separators` is an ordered list of strategies. When a chunk exceeds `maxChunkTokens`, the chunker tries the first strategy; if a resulting piece is still too big, it escalates to the next, and so on. If no strategy can break a piece down further, it is returned as-is (the cascade always terminates).

Each entry may be:

- a **preset key** (string) from `SEPARATORS`
- a **RegExp** (split pattern; uses the default `" "` joiner)
- an object `{ pattern, joiner }` (regex split with a custom joiner)
- an object `{ split, joiner }` (fully custom split function `text => string[]`)

Invalid entries are ignored; if the whole list is invalid, it falls back to the defaults.

### Presets (`SEPARATORS`)

| Key | Splits on | Joiner |
| --- | --- | --- |
| `sentenceWhitespace` | `/(?<=[.?!;])\s+/g` (sentence end + whitespace) | `" "` |
| `sentence` | `/(?<=[.?!;])\s*/g` (sentence end, whitespace optional) | `" "` |
| `newline` | all Unicode newlines (LF, CRLF, CR, VT, FF, NEL, LS, PS) | `"\n"` |
| `whitespace` | `/\s+/g` (any whitespace run) | `" "` |

### Examples

```js
import chunker, { createChunker } from "./chunker.js";

// Reorder tiers: try newlines first, then sentences
await chunker.chunk(text, { separators: ["newline", "sentence"] });

// Custom regex tier (e.g., CSV rows)
await chunker.chunk(csv, { separators: [{ pattern: /,/g, joiner: "," }] });

// Add a last-ditch whitespace tier so punctuation-free, newline-free runs
// can still be broken down
await chunker.chunk(text, { separators: ["sentence", "newline", "whitespace"] });

// Fully custom split function
const byPipes = { split: (t) => String(t).split("|").filter(Boolean), joiner: "|" };
await chunker.chunk(text, { separators: [byPipes] });
```

## Token estimation

Chunk sizes use a fast, approximate estimator (not a real BPE tokenizer). It blends:

- a Unicode-aware regex count (word/number groups, individual CJK characters, and punctuation), with
- a byte/character-length approximation.

Treat `targetTokens` as a **soft budget** — it produces stable, predictable chunk sizes without pulling in a tokenizer dependency. For exact model-token counts, swap in a real tokenizer behind the estimator.

## Notes & edge cases

- Empty or whitespace-only input returns `[]`.
- Non-string input is coerced (objects via `JSON.stringify`, otherwise `String(...)`).
- The fallback sentence splitter preserves sentence-ending punctuation.
- A single sentence larger than `targetTokens` becomes its own chunk, then goes through the oversize cascade.
- `Intl.Segmenter` instances are cached per locale.

## Requirements

- A modern JS runtime with `TextEncoder` (and ideally `Intl.Segmenter`). Set `useIntlSegmenter: false` to rely solely on the regex fallback.

## License

Add your project license information here.
