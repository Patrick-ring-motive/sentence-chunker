/**
 * Cloudflare Worker wrapper for sentence-chunker.
 *
 * Exposes the default chunker (see ./chunker.js) as an HTTP microservice. The
 * core `chunk` function and `SEPARATORS` presets are re-exported on the default
 * export so this module can also be imported directly.
 *
 *   GET  /?text=...&targetTokens=500&overlapSentences=1&locale=en
 *   GET  /?text=...&separators=sentence,newline
 *   POST / { "text": "...", "options": { "targetTokens": 500 } }
 *
 * Response: { "count": n, "chunks": [{ "text", "metadata" }, ...] }
 */
import chunker, { SEPARATORS } from "./chunker.js";

const isString = x => typeof x === "string" || x instanceof String;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });

// Build chunk options from GET query params. Numbers/strings/booleans map
// directly; `separators` accepts a comma-separated list of preset keys
// (e.g. "sentence,newline"). Richer separator specs require a POST body.
const optionsFromQuery = (params) => {
  const options = {};

  for (const key of ["targetTokens", "maxChunkTokens", "overlapSentences"]) {
    const value = params.get(key);
    if (value != null) options[key] = Number(value);
  }

  const locale = params.get("locale");
  if (locale != null) options.locale = locale;

  const useIntlSegmenter = params.get("useIntlSegmenter");
  if (useIntlSegmenter != null) options.useIntlSegmenter = useIntlSegmenter !== "false";

  const separators = params.get("separators");
  if (separators != null)
    options.separators = separators.split(",").map(s => s.trim()).filter(Boolean);

  return options;
};

export default {
  chunk: (...args) => chunker.chunk(...args),
  SEPARATORS,

  async fetch(request) {
    try {
      let text;
      let options = {};

      if (request.method === "GET") {
        const url = new URL(request.url);
        text = url.searchParams.get("text");
        options = optionsFromQuery(url.searchParams);
      } else if (request.method === "POST") {
        const body = await request.json();
        text = body?.text;
        if (body?.options && typeof body.options === "object") options = body.options;
      } else {
        return json({ error: "Method not allowed. Use GET or POST." }, 405);
      }

      if (!isString(text))
        return json({ error: 'Missing or invalid "text". Must be a string.' }, 400);

      const chunks = await chunker.chunk(text, options);
      return json({ count: chunks.length, chunks });
    } catch (error) {
      return json({ error: "Internal server error", message: error.message }, 500);
    }
  }
};
