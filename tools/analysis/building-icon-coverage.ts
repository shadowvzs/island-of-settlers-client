import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";

import { nationalBuildingIconPath } from "../../src/render-common/buildings/building-icon-path";
import { buildingModelRecipe } from "../../src/render-common/content/building-model-recipes";
import type { WorkerNation } from "../../src/render-common/workers/worker-nation";
import { buildingAssetCodes, buildingAssetNations } from "../bench/building-asset-targets";

/** Authored models (monuments of the settler-first nations) keep the GLB node name of the retired temple slot. */
const AUTHORED_NODE_ID = 63;

interface ProofRow { id: number; level: number; nation: string; nodeName: string; path: string; quality: string;
  sha256: string; triangles: number }

/** Node names of the nation's models inside an exported building library GLB (reads only the JSON chunk). */
const libraryNodes = (path: string, nation: string) => {
  const file = openSync(path, "r");
  try {
    const header = Buffer.alloc(20);
    assert.equal(readSync(file, header, 0, 20, 0), 20);
    assert.equal(header.readUInt32LE(0), 0x46546c67);
    assert.equal(header.readUInt32LE(16), 0x4e4f534a);
    const json = Buffer.alloc(header.readUInt32LE(12));
    assert.equal(readSync(file, json, 0, json.length, 20), json.length);
    const gltf = JSON.parse(json.toString("utf8")) as { nodes: { extras?: { nation?: string }; name: string }[] };
    return new Set(gltf.nodes.filter(node => node.extras?.nation === nation).map(node => node.name));
  } finally { closeSync(file); }
};

/** The library node a catalog building's model is exported as (`model.recipe` decides recipe or authored GLB). */
const libraryNode = (nation: WorkerNation, id: number) =>
  `${nation}_${buildingModelRecipe(id, nation, 1).kind === "authored" ? AUTHORED_NODE_ID : id}`;

const checkIcon = (nation: WorkerNation, id: number, record: ProofRow | undefined, roots: Set<string>[]) => {
  const path = nationalBuildingIconPath(nation, id), bytes = readFileSync(path);
  assert(record, `Missing icon provenance: ${path}`);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 240);
  assert.equal(bytes.readUInt32BE(20), 180);
  assert.equal(record.nation, nation);
  assert.equal(record.level, 1);
  assert.equal(record.quality, "high");
  assert.equal(record.path, path);
  assert(record.triangles > 0);
  assert.equal(record.sha256, createHash("sha256").update(bytes).digest("hex"), `Stale icon provenance: ${path}`);
  const node = libraryNode(nation, id);
  assert.equal(node, record.nodeName, `Actual GLB node mismatch: ${path}`);
  roots.forEach(nodes => assert(nodes.has(node), `Missing actual exported GLB node: ${nation}/${node}`));
  return path;
};

const codes = buildingAssetCodes(), nations = buildingAssetNations(), icons: string[] = [];
for (const nation of nations) {
  const proof = JSON.parse(readFileSync(`assets/buildings/${nation}/building-icon-proof.json`, "utf8")) as
    { count: number; icons: ProofRow[]; nation: string };
  assert.equal(proof.nation, nation);
  assert.equal(proof.count, codes.length);
  assert.deepEqual(proof.icons.map(row => row.id).sort((first, second) => first - second), codes);
  const roots = ["high", "minimal"].map(quality =>
    libraryNodes(`assets/buildings/${nation}/${nation}-library-${quality}.glb`, nation));
  roots.forEach(nodes => assert.equal(nodes.size, codes.length));
  for (const id of codes) icons.push(checkIcon(nation, id, proof.icons.find(row => row.id === id), roots));
}
assert.equal(new Set(icons).size, nations.length * codes.length);
console.log(`Building icon gate PASS: ${nations.length} nations × ${codes.length} catalog buildings = ` +
  `${icons.length} actual national model PNGs, native metadata, SHA, dimensions and GLB nodes verified.`);
