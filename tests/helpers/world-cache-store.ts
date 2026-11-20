import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { deserialize, serialize } from "node:v8";

import type * as GenerateWorldModule from "../../src/shared/world/generation/generate-world";
import type { WorldOptions } from "../../src/shared/world/generation/generate-world";
import type { WorldData } from "../../src/shared/world/world-data";

/**
 * Generated-world cache behind the shared world fixtures (TEST-01, `cached-worlds.ts`). Generating
 * a world costs 0.2 s (64²) to 8 s (512²); copying a cached one costs milliseconds. Worlds are
 * keyed by their generation options and kept twice: in memory (shared by every file of a
 * non-isolated worker) and on disk under `node_modules/.cache/world-fixtures/<source hash>/`, so
 * isolated files and later runs reuse them too. The hash covers every source file the generator
 * imports (and the lockfile), so any generator change regenerates. Every read is a fresh
 * `structuredClone`: tests may mutate their world freely without affecting another test.
 * `WORLD_CACHE=off` disables the disk layer.
 */

type GenerateWorld = typeof GenerateWorldModule.generateWorld;

const CLIENT_ROOT = resolve(import.meta.dirname, "../..");
const GENERATOR_ENTRY = join(CLIENT_ROOT, "src/shared/world/generation/generate-world.ts");
const CACHE_ROOT = join(CLIENT_ROOT, "node_modules/.cache/world-fixtures");
const IMPORT_PATTERN = /(?:from\s*|import\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SOURCE_EXTENSIONS = ["", ".ts", ".tsx", "/index.ts"];

const memory = new Map<string, WorldData>();
let diskFolder: string | null | undefined;

const resolveImport = (from: string, specifier: string) => {
  const base = resolve(dirname(from), specifier);
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
};

/** Content hash of the generator's whole relative import graph plus the dependency lockfile. */
const hashGeneratorSources = () => {
  const hash = createHash("sha1");
  const seen = new Set<string>();
  const pending = [GENERATOR_ENTRY];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    hash.update(file).update(source);
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const imported = resolveImport(file, match[1]!);
      if (imported) pending.push(imported);
    }
  }
  const lockfile = join(CLIENT_ROOT, "package-lock.json");
  if (existsSync(lockfile)) hash.update(readFileSync(lockfile));
  return hash.digest("hex").slice(0, 16);
};

/** Drops fixtures of older generator versions; another run may still be reading them. */
const removeStaleFolders = (current: string) => {
  for (const entry of readdirSync(CACHE_ROOT)) {
    if (entry === current) continue;
    rmSync(join(CACHE_ROOT, entry), { force: true, recursive: true });
  }
};

const getDiskFolder = () => {
  if (diskFolder !== undefined) return diskFolder;
  if (process.env.WORLD_CACHE === "off") return (diskFolder = null);
  try {
    const version = hashGeneratorSources();
    diskFolder = join(CACHE_ROOT, version);
    if (!existsSync(diskFolder)) {
      mkdirSync(diskFolder, { recursive: true });
      removeStaleFolders(version);
    }
  } catch {
    diskFolder = null;
  }
  return diskFolder;
};

const readDisk = (file: string) => {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
};

const writeDisk = (file: string, data: Buffer) => {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, data);
    renameSync(temporary, file);
  } catch {
    rmSync(temporary, { force: true });
  }
};

/** Key order does not matter: `{ ...A, seed }` and `{ seed, ...A }` are the same world. */
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
};

const optionsKey = (options: WorldOptions) =>
  createHash("sha1").update(stableJson(options)).digest("hex");

/** The master copy of a world; never handed to a test (deserialized views share its buffer). */
export const loadWorld = (generate: GenerateWorld, options: WorldOptions) => {
  const key = optionsKey(options);
  const remembered = memory.get(key);
  if (remembered) return remembered;
  const folder = getDiskFolder();
  const file = folder ? join(folder, `${key}.bin`) : null;
  const stored = file ? readDisk(file) : null;
  const world = stored ? (deserialize(stored) as WorldData) : generate(options);
  if (file && !stored) writeDisk(file, serialize(world));
  memory.set(key, world);
  return world;
};

/**
 * Wraps a world generator with the cache. Calls with a theme layout or a phase callback are not
 * cacheable and go straight to the generator.
 */
export const withWorldCache = (generate: GenerateWorld): GenerateWorld =>
  (options, themeLayout, onPhase) => {
    if (!options || themeLayout || onPhase) return generate(options, themeLayout, onPhase);
    return structuredClone(loadWorld(generate, options));
  };

/**
 * Module mock factory: the real generate-world module with a cached `generateWorld`, for files
 * whose production code generates the world itself (adventure/colony islands). Only in `slow`
 * (isolated) files: under `isolate: false` a module mock leaks into the worker's later files.
 * ```ts
 * vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
 *   (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));
 * ```
 */
export const cachedGenerateWorldModule = async (
  importOriginal: () => Promise<typeof GenerateWorldModule>
) => {
  const actual = await importOriginal();
  return { ...actual, generateWorld: withWorldCache(actual.generateWorld) };
};
