const DEFAULT_OPTIONS = {
  targetTokens: 500,
  maxChunkTokens: 1000,
  overlapSentences: 1,
  locale: "en",
  useIntlSegmenter: true,
  // Oversize-rescue cascade: tried in order until a chunk fits maxChunkTokens.
  // Each entry may be a preset key (see SEPARATORS), a RegExp, or
  // an object { pattern|split, joiner }.
  separators: ["sentence", "newline"],
};

const isString = (x) => typeof x === "string" || x instanceof String;
const isArray = (x) => Array.isArray(x) || x instanceof Array;
const stringify = (value) => {
  if (isString(value)) return String(value);
  if (value == null) return "";
  try {
    return String(JSON.stringify(value));
  } catch {
    return String(value);
  }
};

const encode = TextEncoder.prototype.encode.bind(new TextEncoder());

const toPositiveInt = (value, fallback) => {
  const n = Number(value) || parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const normalizeOptions = (options = {}) => {
  const targetTokens = toPositiveInt(
    options.targetTokens,
    DEFAULT_OPTIONS.targetTokens,
  );
  const maxChunkTokens = toPositiveInt(options.maxChunkTokens, targetTokens * 2);
  const overlapSentences = Math.max(
    0,
    toPositiveInt(options.overlapSentences, DEFAULT_OPTIONS.overlapSentences),
  );

  return {
    targetTokens,
    maxChunkTokens,
    overlapSentences,
    locale: isString(options.locale) ? String(options.locale) : DEFAULT_OPTIONS.locale,
    useIntlSegmenter: typeof options.useIntlSegmenter === "boolean" ?
      options.useIntlSegmenter : DEFAULT_OPTIONS.useIntlSegmenter,
    separators: normalizeSeparators(options.separators),
  };
};

// Lightweight token approximation:
// - words/numbers
// - punctuation
// - individual CJK chars
// blended with chars/4 approximation for stability.
const estimateTokens = (text) => {
  const s = stringify(text).trim();
  if (!s) return 0;
  const matches = s.match(
    /[\p{L}\p{N}]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s]/gu,
  );
  const regexEstimate = matches ? matches.length : 0;
  const charsEstimate = Math.ceil((s.length + encode(s).length) / 8);
  return Math.ceil((regexEstimate + charsEstimate) / 2);
};

const segmenterCache = new Map();

const getSentenceSegmenter = (locale, useIntlSegmenter) => {
  if (!useIntlSegmenter) return null;
  if (typeof Intl === "undefined" || !Intl.Segmenter) return null;

  const key = String(locale || DEFAULT_OPTIONS.locale);
  if (segmenterCache.has(key)) return segmenterCache.get(key);

  try {
    const segmenter = new Intl.Segmenter(key, {
      granularity: "sentence"
    });
    segmenterCache.set(key, segmenter);
    return segmenter;
  } catch {
    return null;
  }
};

const splitSentences = (text, options) => {
  const s = stringify(text).trim();
  if (!s) return [];

  const sentenceSegmenter = getSentenceSegmenter(
    options?.locale,
    options?.useIntlSegmenter,
  );

  if (sentenceSegmenter) {
    const segments = [];
    for (const part of sentenceSegmenter.segment(s)) {
      const sentence = part.segment.trim();
      if (sentence) segments.push(sentence);
    }
    if (segments.length) return segments;
  }

  // Fallback heuristic splitter (primary regex tier: sentence endings + whitespace).
  // Punctuation is preserved because the split consumes whitespace AFTER punctuation.
  return s
    .split(/(?<=[.?!;])\s+/g)
    .map((t) => t.trim())
    .filter(Boolean);
};

const splitByNewlines = (text) => {
  return stringify(text)
    // Handle common and Unicode newline separators:
    // LF (\n), CRLF (\r\n), CR (\r), VT (\v), FF (\f),
    // NEL (\u0085), LS (\u2028), PS (\u2029)
    .split(/(?:\r\n|[\n\r\v\f\u0085\u2028\u2029])+/g)
    .map((t) => t.trim())
    .filter(Boolean);
};

const makeChunk = (sentences, tokenCount, index) => ({
  text: sentences.join(" ").trim(),
  metadata: {
    chunkIndex: index,
    tokenEstimate: tokenCount,
    sentenceCount: sentences.length,
  },
});

// Built-in separator presets for the oversize-rescue cascade.
// Reference these by key (e.g. "sentence") in the `separators` option,
// or supply your own { pattern, joiner } / { split, joiner } entries.
export const SEPARATORS = {
  // Sentence endings followed by required whitespace.
  sentenceWhitespace: {
    pattern: /(?<=[.?!;])\s+/g,
    joiner: " "
  },
  // Sentence endings, whitespace optional (more aggressive).
  sentence: {
    pattern: /(?<=[.?!;])\s*/g,
    joiner: " "
  },
  // All Unicode newline variants.
  newline: {
    split: splitByNewlines,
    joiner: "\n"
  },
  // Any run of whitespace (last-ditch).
  whitespace: {
    pattern: /\s+/g,
    joiner: " "
  },
};

const DEFAULT_JOINER = " ";

const makeRegexSplitter = (pattern) => (text) =>
  stringify(text)
  .split(pattern)
  .map((t) => t.trim())
  .filter(Boolean);

// Normalize a single separator spec into { split, joiner }.
// Accepts: preset key (string), RegExp, or { pattern|split, joiner }.
const normalizeSeparator = (spec) => {
  if (isString(spec)) {
    const preset = SEPARATORS[spec];
    return preset ? normalizeSeparator(preset) : null;
  }

  if (spec instanceof RegExp) {
    return {
      split: makeRegexSplitter(spec),
      joiner: DEFAULT_JOINER
    };
  }

  if (spec && typeof spec === "object") {
    const joiner = isString(spec.joiner) ? spec.joiner : DEFAULT_JOINER;
    if (typeof spec.split === "function") {
      return {
        split: spec.split,
        joiner
      };
    }
    if (spec.pattern instanceof RegExp) {
      return {
        split: makeRegexSplitter(spec.pattern),
        joiner
      };
    }
  }

  return null;
};

// Normalize the `separators` option into an ordered list of { split, joiner }.
const normalizeSeparators = (separators) => {
  const list = isArray(separators) ? separators : DEFAULT_OPTIONS.separators;
  const normalized = list.map(normalizeSeparator).filter(Boolean);
  return normalized.length ?
    normalized :
    DEFAULT_OPTIONS.separators.map(normalizeSeparator);
};

const regroupPieces = (pieces, joiner, baseChunk, options) => {
  const out = [];
  let buffer = [];
  let bufferTokens = 0;

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join(joiner).trim();
    out.push({
      text,
      metadata: {
        ...baseChunk.metadata,
        tokenEstimate: estimateTokens(text),
        sentenceCount: splitSentences(text, options).length || 1,
      },
    });
    buffer = [];
    bufferTokens = 0;
  };

  for (const piece of pieces) {
    const pieceTokens = estimateTokens(piece);
    if (bufferTokens + pieceTokens > options.targetTokens && buffer.length > 0) {
      flush();
    }
    buffer.push(piece);
    bufferTokens += pieceTokens;
  }

  flush();
  return out;
};

// Recursively split a chunk that exceeds maxChunkTokens, escalating through
// OVERSIZE_SPLIT_LEVELS until it fits or no strategy can break it down further.
const rescueOversizedChunk = (chunk, options, level = 0) => {
  const levels = options.separators;
  const tokens = chunk.metadata?.tokenEstimate ?? estimateTokens(chunk.text);

  if (tokens <= options.maxChunkTokens || level >= levels.length) {
    return [chunk];
  }

  const {
    split,
    joiner
  } = levels[level];
  const pieces = split(chunk.text);

  // This strategy can't break it down further; escalate.
  if (pieces.length <= 1) {
    return rescueOversizedChunk(chunk, options, level + 1);
  }

  const regrouped = regroupPieces(pieces, joiner, chunk, options);

  // Any regrouped chunk still too big escalates to the next tier.
  const out = [];
  for (const rc of regrouped) {
    out.push(...rescueOversizedChunk(rc, options, level + 1));
  }
  return out;
};

export const createChunker = (baseOptions = {}) => {
  const normalizedBase = normalizeOptions(baseOptions);

  return {
    /**
     * chunk(text, flags?)
     *
     * flags:
     * - targetTokens: number (default 500)
     * - maxChunkTokens: number (default targetTokens * 2)
     * - overlapSentences: number (default 1)
     * - locale: string (default "en")
     * - useIntlSegmenter: boolean (default true)
     * - separators: Array (default ["sentence", "newline"])
     *     Oversize-rescue cascade, tried in order. Each entry may be a
     *     preset key (see SEPARATORS), a RegExp, or { pattern|split, joiner }.
     */
    async chunk(text, flags = {}) {
      const options = normalizeOptions({
        ...normalizedBase,
        ...flags
      });
      const source = stringify(text);
      if (!source.trim()) return [];

      const sentences = splitSentences(source, options);
      if (!sentences.length) {
        return [makeChunk([source.trim()], estimateTokens(source), 0)];
      }

      const out = [];
      let buffer = [];
      let bufferTokens = 0;
      let chunkIndex = 0;

      const flushWithOverlap = () => {
        if (!buffer.length) return;

        out.push(makeChunk(buffer, bufferTokens, chunkIndex++));

        if (options.overlapSentences <= 0) {
          buffer = [];
          bufferTokens = 0;
          return;
        }

        const overlap = buffer.slice(-options.overlapSentences);
        buffer = overlap;
        bufferTokens = overlap.reduce((sum, sentence) => {
          return sum + estimateTokens(sentence);
        }, 0);
      };

      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);

        // Handle very long single sentence by forcing its own chunk.
        if (!buffer.length && sentenceTokens >= options.targetTokens) {
          out.push(makeChunk([sentence], sentenceTokens, chunkIndex++));
          continue;
        }

        if (
          bufferTokens + sentenceTokens > options.targetTokens &&
          buffer.length > 0
        ) {
          flushWithOverlap();
        }

        buffer.push(sentence);
        bufferTokens += sentenceTokens;
      }

      if (buffer.length) {
        // Avoid duplicate final chunk if overlap buffer is already identical
        // to the last emitted chunk's trailing overlap.
        const candidate = buffer.join(" ").trim();
        const previous = out[out.length - 1]?.text;
        if (candidate && candidate !== previous) {
          out.push(makeChunk(buffer, bufferTokens, chunkIndex++));
        }
      }

      // If any chunk is still oversized, escalate splitting:
      // sentence endings (\s*) -> newlines.
      const rescued = [];
      for (const c of out) {
        rescued.push(...rescueOversizedChunk(c, options));
      }

      // Final sequential re-index.
      return rescued.map((c, i) => ({
        ...c,
        metadata: {
          ...c.metadata,
          chunkIndex: i,
        },
      }));
    },
  };
};

const chunker = createChunker();

export default chunker;
