import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

/** Words of one literal group: string literals and object keys directly inside one `[`, `{` or `(`. */
type Group = Set<string>;

const OPENERS = new Set(["[", "{", "("]);
const CLOSERS = new Set(["]", "}", ")"]);
const IDENTIFIER = /[A-Za-z0-9_$]/;

const skipLineComment = (source: string, index: number) => {
  const end = source.indexOf("\n", index);
  return end < 0 ? source.length : end;
};

const skipBlockComment = (source: string, index: number) => {
  const end = source.indexOf("*/", index + 2);
  return end < 0 ? source.length : end + 2;
};

/** End of the string or template literal starting at `index` and its text (templates keep their raw text). */
const readQuoted = (source: string, index: number) => {
  const quote = source[index]!;
  let cursor = index + 1;
  while (cursor < source.length && source[cursor] !== quote) cursor += source[cursor] === "\\" ? 2 : 1;
  return { end: cursor + 1, text: source.slice(index + 1, cursor) };
};

/** A bare identifier followed by `:` (an object key such as `logs: 10`). */
const readObjectKey = (source: string, index: number) => {
  let cursor = index;
  while (cursor < source.length && IDENTIFIER.test(source[cursor]!)) cursor++;
  const word = source.slice(index, cursor);
  let after = cursor;
  while (source[after] === " " || source[after] === "\t") after++;
  return { end: cursor, key: source[after] === ":" && source[after + 1] !== ":" ? word : null };
};

/**
 * Splits a TypeScript or JSON source into literal groups, ignoring comments: every bracket pair collects the
 * string literals and object keys directly inside it (nested groups collect their own).
 */
export const literalGroups = (source: string): Group[] => {
  const stack: Group[] = [new Set()];
  const groups: Group[] = [stack[0]!];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (char === "/" && next === "/") index = skipLineComment(source, index);
    else if (char === "/" && next === "*") index = skipBlockComment(source, index);
    else if (char === "\"" || char === "'" || char === "`") {
      const { end, text } = readQuoted(source, index);
      stack.at(-1)!.add(text);
      index = end;
    } else if (OPENERS.has(char)) {
      const group: Group = new Set();
      stack.push(group);
      groups.push(group);
      index++;
    } else if (CLOSERS.has(char)) {
      if (stack.length > 1) stack.pop();
      index++;
    } else if (IDENTIFIER.test(char) && !IDENTIFIER.test(source[index - 1] ?? " ")) {
      const { end, key } = readObjectKey(source, index);
      if (key) stack.at(-1)!.add(key);
      index = end;
    } else index++;
  }
  return groups;
};

/** Kinds whose known keys appear `threshold` or more times inside one literal group of the source. */
export const contentListKinds = (
  source: string, keysByKind: ReadonlyMap<string, ReadonlySet<string>>, threshold: number
): string[] => {
  const kinds = new Set<string>();
  for (const group of literalGroups(source)) for (const [kind, keys] of keysByKind) {
    let count = 0;
    for (const word of group) if (keys.has(word)) count++;
    if (count >= threshold) kinds.add(kind);
  }
  return [...kinds].sort();
};

/** Source and data files below `folder`, as paths relative to `root`, skipping the excluded prefixes. */
export const listScannedFiles = (
  root: string, folder: string, extensions: readonly string[], excluded: readonly string[]
): string[] => {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    const name = relative(root, path);
    if (entry.name === "node_modules" || excluded.some(prefix => name.startsWith(prefix))) return [];
    if (entry.isDirectory()) return walk(path);
    return extensions.some(extension => entry.name.endsWith(extension)) ? [name] : [];
  });
  return walk(join(root, folder)).sort();
};
