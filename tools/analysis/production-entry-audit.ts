import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { DEV_ONLY_PAGES, PRODUCTION_ENTRIES } from "../page-entries.ts";

interface ManifestChunk {
  dynamicImports?: string[];
  file: string;
  imports?: string[];
  isEntry?: boolean;
  src?: string;
}

type Manifest = Record<string, ManifestChunk>;

const root = resolve(import.meta.dirname, "../..");
const dist = join(root, "dist");
const manifestPath = join(dist, ".vite/manifest.json");

const fail = (message: string): never => {
  throw new Error(`Production entry audit: ${message}`);
};

if (!existsSync(manifestPath)) fail(`missing ${manifestPath}; run vite build first`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

const entryKey = (page: string) => {
  const key = Object.entries(manifest).find(([name, chunk]) => name === page ||
    (chunk.isEntry === true && chunk.src === page))?.[0];
  return key ?? fail(`no manifest entry for ${page}`);
};

const reachable = (entry: string) => {
  const found = new Set<string>();
  const visit = (key: string) => {
    if (found.has(key)) return;
    found.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    for (const imported of [...chunk.imports ?? [], ...chunk.dynamicImports ?? []]) visit(imported);
  };
  visit(entry);
  return found;
};

const matches = (key: string, fragment: string) => key.includes(fragment);

const player = reachable(entryKey(PRODUCTION_ENTRIES.main));
const admin = reachable(entryKey(PRODUCTION_ENTRIES.admin));
const editor = reachable(entryKey(PRODUCTION_ENTRIES.editor));

/** These modules must never be reachable from the player HTML entry (static or dynamic). */
const PLAYER_FORBIDDEN = [
  "admin-main",
  "admin-modules",
  "dev-params",
  "editor-main",
  "island-development-tools",
  "local-dev-modules",
  "military-ai-debug",
  "military-benchmark-window",
  "scene-replay",
  "settlement/debug-click-modes",
  "settlement/settlement-debug-actions",
  "src/app/admin/"
] as const;

for (const fragment of PLAYER_FORBIDDEN) {
  const leaked = [...player].filter((key) => matches(key, fragment));
  if (leaked.length) fail(`player entry reaches ${leaked.join(", ")}`);
}

for (const fragment of ["admin-modules", "island-development-tools", "dev-params", "admin/mount-admin-window"]) {
  if (![...admin].some((key) => matches(key, fragment)))
    fail(`admin entry is missing ${fragment}`);
}
if (![...editor].some((key) => matches(key, "admin-modules")))
  fail("editor entry is missing the admin modules");

for (const page of Object.values(PRODUCTION_ENTRIES)) {
  if (!existsSync(join(dist, page))) fail(`missing production page ${page}`);
}
for (const page of DEV_ONLY_PAGES) {
  if (existsSync(join(dist, page))) fail(`dev-only page ${page} shipped`);
}

const indexHtml = readFileSync(join(dist, PRODUCTION_ENTRIES.main), "utf8");
const adminHtml = readFileSync(join(dist, PRODUCTION_ENTRIES.admin), "utf8");
const adminChunkFile = manifest[entryKey(PRODUCTION_ENTRIES.admin)]!.file.split("/").pop()!;
if (/admin-main|admin-modules/.test(indexHtml) || indexHtml.includes(adminChunkFile))
  fail("player HTML references admin code");
if (!adminHtml.includes(adminChunkFile)) fail("admin HTML does not reference its admin entry");

console.log(`Production entry audit passed: ${player.size} player modules, ${admin.size} admin modules, ` +
  `${editor.size} editor modules; no dev-only pages.`);
