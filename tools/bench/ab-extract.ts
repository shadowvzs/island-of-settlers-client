/**
 * Metric extraction for the A/B perf runner (TOOL-4). Pure: takes a bench's stdout text and returns the values.
 *
 * A spec is written `name=/regex/flags` (first match; the named group `value`, else group 1, else the whole match)
 * or `name=json:path.to.field` (read from the bench's `BENCH_JSON {...}` lines, see `bench-json.ts`; several lines
 * are merged in order). Array items are addressed by index (`battles.0.tickAvg` or `battles[0].tickAvg`). A key
 * that itself contains dots is written `["high.s1.webgpu"]` or with escaped dots (`high\.s1\.webgpu`).
 */

export const BENCH_JSON_PREFIX = "BENCH_JSON ";

export type ExtractorSource = { kind: "json"; path: string } | { kind: "regex"; pattern: RegExp };

export interface ExtractorSpec {
  name: string;
  source: ExtractorSource;
}

const REGEX_LITERAL = /^\/(.*)\/([a-z]*)$/s;

const parseSource = (text: string): ExtractorSource => {
  if (text.startsWith("json:")) return { kind: "json", path: text.slice("json:".length) };
  const [, body, flags = ""] = REGEX_LITERAL.exec(text) ?? [];
  if (body === undefined) throw new Error(`Extractor "${text}" is neither /regex/flags nor json:path`);
  return { kind: "regex", pattern: new RegExp(body, flags.replace("g", "")) };
};

/** Parses `name=/regex/flags` or `name=json:path`. */
export const parseExtractor = (spec: string): ExtractorSpec => {
  const separator = spec.indexOf("=");
  if (separator <= 0) throw new Error(`Extractor "${spec}" needs name=/regex/ or name=json:path`);
  return { name: spec.slice(0, separator), source: parseSource(spec.slice(separator + 1)) };
};

/** Merges every `BENCH_JSON` line of the output (later keys win); lines that do not parse are skipped. */
export const benchJsonOf = (output: string): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};
  for (const line of output.split("\n")) {
    if (!line.startsWith(BENCH_JSON_PREFIX)) continue;
    try { Object.assign(merged, JSON.parse(line.slice(BENCH_JSON_PREFIX.length))); }
    catch { /* a truncated line is reported as a missing value */ }
  }
  return merged;
};

/** One bracket segment: a quoted key, a numeric index or an unquoted key. */
const bracketSegment = (inner: string): number | string => {
  const quoted = /^"(.*)"$/s.exec(inner) ?? /^'(.*)'$/s.exec(inner);
  if (quoted) return quoted[1]!;
  return /^\d+$/.test(inner) ? Number(inner) : inner;
};

/** Index of the bracket that closes `open`, skipping ] inside a quoted key; -1 when unclosed. */
const closingBracket = (path: string, open: number): number => {
  let quote = "";
  for (let cursor = open + 1; cursor < path.length; cursor += 1) {
    const char = path[cursor]!;
    if (quote.length > 0) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "]") return cursor;
  }
  return -1;
};

/**
 * Splits a JSON path into keys and array indices: `a.b`, `a[0]`, `a["x.y"]`, `a\.b` (a literal dot).
 * Bracket keys may be quoted (single or double) when they contain dots, spaces or brackets.
 */
const pathSegments = (path: string): (number | string)[] => {
  const segments: (number | string)[] = [];
  let key = "";
  let index = 0;
  const flushKey = () => {
    if (key.length === 0) return;
    segments.push(key);
    key = "";
  };
  while (index < path.length) {
    const char = path[index]!;
    if (char === "\\" && path[index + 1] === ".") {
      key += ".";
      index += 2;
      continue;
    }
    if (char === ".") {
      flushKey();
      index += 1;
      continue;
    }
    if (char !== "[") {
      key += char;
      index += 1;
      continue;
    }
    flushKey();
    const close = closingBracket(path, index);
    if (close < 0) throw new Error(`JSON path "${path}" has an unclosed [`);
    const inner = path.slice(index + 1, close).trim();
    if (inner.length === 0) throw new Error(`JSON path "${path}" has an empty []`);
    segments.push(bracketSegment(inner));
    index = close + 1;
  }
  flushKey();
  return segments;
};

export const valueAtPath = (record: unknown, path: string): unknown => {
  const segments = pathSegments(path);
  if (segments.length === 0) return undefined;
  let current = record;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
};

const regexValue = (output: string, pattern: RegExp) => {
  const match = pattern.exec(output);
  if (!match) return undefined;
  return match.groups?.value ?? match[1] ?? match[0];
};

/** Raw text of one extractor, or undefined when the output does not contain it. */
export const extractText = (output: string, json: Record<string, unknown>, source: ExtractorSource) => {
  if (source.kind === "regex") return regexValue(output, source.pattern);
  const value = valueAtPath(json, source.path);
  if (value === undefined || value === null) return undefined;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

export interface ExtractedRun {
  hashes: Record<string, string>;
  /** Extractors that found nothing in this run's output. */
  missing: string[];
  numbers: Record<string, number>;
}

/** Applies the metric (numeric) and hash (exact text) extractors to one run's stdout. */
export const extractRun = (
  output: string,
  metrics: readonly ExtractorSpec[],
  hashes: readonly ExtractorSpec[]
): ExtractedRun => {
  const json = benchJsonOf(output);
  const run: ExtractedRun = { hashes: {}, missing: [], numbers: {} };
  for (const { name, source } of metrics) {
    const value = Number(extractText(output, json, source));
    if (Number.isFinite(value)) run.numbers[name] = value;
    else run.missing.push(name);
  }
  for (const { name, source } of hashes) {
    const text = extractText(output, json, source);
    if (text === undefined) run.missing.push(name);
    else run.hashes[name] = text;
  }
  return run;
};
