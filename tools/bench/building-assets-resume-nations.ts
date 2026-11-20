import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { validateGallerySourceFiles } from "./building-gallery-source";
import { resourcesPath } from "./resources-path";

// Resume only the failed national stage, retaining a byte-certified successful Roman stage.
// All remaining commands are the original building-assets stages, with the same default gates.
const output = resourcesPath("project-reviews", "building-assets-sync-2026-11-04", "full-b");
const proofFile = process.argv.find(argument => argument.startsWith("--roman-proof="))?.slice(14)
  ?? "roman-retained-stage-proof.json";
assert(/^[a-z0-9-]+\.json$/.test(proofFile), "Unsafe retained Roman proof filename");
const proof = JSON.parse(readFileSync(resolve(output, proofFile), "utf8"));
const ids = BUILDING_CATALOG.map(row => row.id).sort((a, b) => a - b);
const nations = ["viking", "nubian", "japanese", "indigenous", "chinese", "persian", "maya"];
assert.equal(process.env.BUILDING_ASSET_PREFLIGHT, "run");
assert.equal(process.env.BUILDING_ASSET_BUDGET_ONLY, "0");
assert.deepEqual(process.env.BUILDING_PREVIEW_IDS?.split(",").map(Number).sort((a, b) => a - b), ids);
assert.deepEqual(process.env.BUILDING_NATIONS?.split(",").sort(), [...nations].sort());
assert.equal(proof.defaultPreflight.tests, 583); assert.equal(proof.defaultPreflight.passed, true);
assert.equal(proof.romanIcons, ids.length); assert.equal(proof.nativeFullyClosed, true);
assert.equal(proof.canonicalPreviewCoverage.qualityPreviews, ids.length * 2);
assert.equal(proof.canonicalPreviewCoverage.individualSamples, ids.length);
assert.deepEqual(proof.libraries.map((library: { quality: string; models: number }) =>
  [library.quality, library.models]), [["high", ids.length], ["minimal", ids.length]]);
assert.deepEqual(validateGallerySourceFiles(proof.sources), [], "Retained Roman source changed");
assert.deepEqual(validateGallerySourceFiles(proof.outputs), [], "Retained Roman output changed");
const completedProofFile = process.argv.find(argument => argument.startsWith("--completed-nations-proof="))
  ?.slice("--completed-nations-proof=".length);
let retainedNations: string[] = [], retainedNationalOutputs: Record<string, { sha256: string; bytes: number }> = {};
if (completedProofFile) {
  assert(/^[a-z0-9-]+\.json$/.test(completedProofFile), "Unsafe completed nation proof filename");
  const completedProof = JSON.parse(readFileSync(resolve(output, completedProofFile), "utf8"));
  retainedNations = completedProof.completedNations;
  assert(Array.isArray(retainedNations) && retainedNations.every(nation => nations.includes(nation)));
  assert.equal(new Set(retainedNations).size, retainedNations.length);
  assert.equal(completedProof.nativeFullyClosed, true);
  assert.equal(completedProof.defaultPreflight.tests, 583); assert.equal(completedProof.defaultPreflight.passed, true);
  assert.deepEqual(validateGallerySourceFiles(completedProof.sources), [], "Retained national source changed");
  retainedNationalOutputs = completedProof.outputs;
  assert.deepEqual(validateGallerySourceFiles(retainedNationalOutputs), [], "Retained national output changed");
}
const freshNations = nations.filter(nation => !retainedNations.includes(nation));
assert(freshNations.length, "Nothing remains for national library export");
const completed: string[] = [];
const run = (label: string, executable: string, args: string[]) => {
  console.log(`Building-assets resume START: ${label}`);
  execFileSync(executable, args, { stdio: "inherit", env: process.env });
  completed.push(label);
  writeFileSync(resolve(output, "resumed-production-progress.json"), JSON.stringify({
    updatedAt: new Date().toISOString(), retainedRomanProof: proofFile, retainedNationalProof: completedProofFile,
    retainedNations, freshNations, completed,
    complete: false, policy: "All original remaining stages and default gates; no final coherence claim until completion."
  }, null, 2));
  console.log(`Building-assets resume CLOSED: ${label}`);
};
const tsx = (label: string, path: string, args: string[] = []) =>
  run(label, process.execPath, ["node_modules/tsx/dist/cli.mjs", path, ...args]);
run("default entrance/support preflight", process.execPath, ["node_modules/vitest/vitest.mjs", "run",
  "tests/building-entrances.test.ts", "tests/building-supports.test.ts"]);
tsx("all remaining national libraries/previews/icons", "tools/bench/nation-building-assets.ts",
  [`--nations=${freshNations.join(",")}`]);
tsx("neutral libraries/previews", "tools/bench/neutral-building-assets.ts");
run("camp assets", "npm", ["run", "camp-assets"]);
tsx("all456 actual icon and GLB node links", "tools/analysis/building-icon-coverage.ts");
tsx("all16 GLB animation channel bindings", "tools/analysis/building-library-animation-coverage.ts");
run("national BuildingIcon routes", process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project", "unit",
  "tests/national-building-icon-coverage.test.ts"]);
assert.deepEqual(validateGallerySourceFiles(proof.sources), [], "Building source changed during resumed export");
// Catalog normalization is an original required stage; its result is checked against both actual GLBs.
const retainedOutputs = { ...proof.outputs }; delete retainedOutputs["assets/buildings/roman/catalog.json"];
assert.deepEqual(validateGallerySourceFiles(retainedOutputs), [], "Retained Roman geometry/icon bytes changed");
assert.deepEqual(validateGallerySourceFiles(retainedNationalOutputs), [], "Retained national geometry/icon bytes changed");
const completion = {
  completedAt: new Date().toISOString(), complete: true, nativeFullyClosed: true,
  retainedRomanProof: proofFile, retainedNationalProof: completedProofFile, retainedNations, freshNations,
  completed, allNations: ["roman", ...nations],
  variantsPerNation: ids.length, nationalIcons: ids.length * 8, defaultPreflight: true,
  originalTriangleBudgetPolicy: true, policy: "Roman and completed national stages retained with explicit current source/output semantic certificates. Every remaining nation and all original remaining stages execute with default checks; this resume does not claim all national PNGs were rendered again."
};
writeFileSync(resolve(output, "resumed-production-completion.json"), JSON.stringify(completion, null, 2));
writeFileSync(resolve(output, "resumed-production-progress.json"), JSON.stringify(completion, null, 2));
console.log("Building-assets resumed pipeline COMPLETE and all native stages FULL CLOSED.");
