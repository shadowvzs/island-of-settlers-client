import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface Chunk { file: string; imports?: string[]; dynamicImports?: string[] }
const dist = resolve("dist"), manifest = JSON.parse(readFileSync(resolve(dist, ".vite/manifest.json"), "utf8")) as Record<string, Chunk>;
const closure = (roots: string[]) => {
  const found = new Set<string>();
  const visit = (key: string) => {
    if (found.has(key)) return;
    found.add(key);
    for (const imported of manifest[key]?.imports ?? []) visit(imported);
  };
  roots.forEach(visit); return found;
};
const keys = Object.keys(manifest);
const model = keys.find(key => key.endsWith("/road-decoration-model.ts"));
const plant = keys.find(key => key.endsWith("/road-plant-model-core.ts"));
assert(model, "Missing dynamic decoration model chunk"); assert(plant, "Missing dynamic plant model chunk");
const renderer = keys.find(key => key.includes("create-three-renderer")) ??
  keys.find(key => key.includes("three-renderer"));
assert(renderer, "Missing renderer chunk in production manifest");
const initial = closure([renderer]);
assert(!initial.has(model), "Decoration model is eagerly imported by renderer");
assert(!initial.has(plant), "Plant model is eagerly imported by renderer");
const describe = (key: string) => ({ key, file: manifest[key]!.file,
  bytes: statSync(resolve(dist, manifest[key]!.file)).size });
const retryExport = (key: string, expected: string) => {
  const source = readFileSync(resolve(dist, manifest[key]!.file), "utf8");
  const exports = [...source.matchAll(/export\s*\{([^}]+)\}/g)]
    .flatMap(match => match[1]!.split(",").map(entry => entry.trim().split(/\s+as\s+/).at(-1)));
  assert(exports.includes(expected), `Raw same-origin retry chunk lacks expected export ${expected}: ${key}`);
  return { ...describe(key), retryExport: expected };
};
const report = { renderer: describe(renderer), deferred: [
  retryExport(model, "createRoadDecorationModel"), retryExport(plant, "createRoadPlantModelWithFactory")],
  rendererStaticBytes: [...initial].reduce((sum, key) => sum + statSync(resolve(dist, manifest[key]!.file)).size, 0),
  dynamicRecipeEntries: keys.filter(key => /road-decoration-(models|plants)\.ts$/.test(key)).map(describe),
  physicalAuthority: "Canonical collision/placement recipe graph stays synchronous; this audit checks GPU builders only." };
const output = process.argv.find(argument => argument.startsWith("--out="))?.slice(6);
if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
