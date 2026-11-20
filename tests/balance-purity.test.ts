import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BALANCE_DIRECTORY = resolve(import.meta.dirname, "../src/shared/balance");
const IMPORT_PATTERN = /^\s*(import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT_PATTERN = /^\s*import\s+["'][^"']+["']/m;

/** Runtime imports are allowed only between balance files; anything else must be `import type`. */
const runtimeImports = (source: string) => [...source.matchAll(IMPORT_PATTERN)]
  .filter(([statement, , specifier]) => !/^\s*(import|export)\s+type\b/.test(statement) &&
    !/^\.\/[\w-]+(\.ts)?$/.test(specifier!))
  .map(([statement]) => statement.trim());

describe("balance settings", () => {
  const files = readdirSync(BALANCE_DIRECTORY).filter(file => file.endsWith(".ts"));

  it("has balance files", () => expect(files.length).toBeGreaterThan(0));

  it.each(files)("%s is pure data without runtime imports", file => {
    const source = readFileSync(resolve(BALANCE_DIRECTORY, file), "utf8");
    expect(runtimeImports(source)).toEqual([]);
    expect(SIDE_EFFECT_IMPORT_PATTERN.test(source)).toBe(false);
  });
});
