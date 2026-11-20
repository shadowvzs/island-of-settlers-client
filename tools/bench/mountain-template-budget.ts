import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createVertexFog } from "../../src/render-common/chunk-sampling";
import { buildIslandRockSkins } from "../../src/render-common/rocks/island-rocks";
import { listRegionChunks } from "../../src/render-common/terrain-chunks";
import { applyStampChange } from "../../src/shared/world/editing/terrain/terrain-apply";
import { addStamp, createTerrainEditState } from "../../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { BUILD, PROP } from "../../src/shared/world/world-data";

const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000 });
let spot: { x: number; z: number } | undefined;
for (let z = 20; z < 76 && !spot; z += 1) for (let x = 20; x < 76 && !spot; x += 1) {
  const vertex = z * 97 + x;
  if (world.buildClass[z * 96 + x] === BUILD.large && world.riverDistance[vertex]! > 18 &&
    world.coastDistance[vertex]! > 14) spot = { x: x + 0.5, z: z + 0.5 };
}
assert(spot);
const state = createTerrainEditState();
const before = world.heights.slice();
const started = performance.now();
const applied = applyStampChange(world, state,
  addStamp(state, spot, 6, 51, { template: "great-mountain-v1" }));
const applyMs = performance.now() - started;
const chunks = listRegionChunks(world, applied.cells);
const fog = createVertexFog(world);
const qualities = ["full", "coarse"] as const;
const meshes = qualities.map(detail => {
  const started = performance.now();
  const meshes = buildIslandRockSkins(world, fog, 0, 1, chunks, detail);
  return { detail, buildMs: performance.now() - started,
    triangles: meshes.reduce((count, mesh) => count + mesh.data.triangles, 0),
    vertices: meshes.reduce((count, mesh) => count + mesh.data.vertexCount, 0),
    buffers: meshes.reduce((bytes, mesh) => bytes + mesh.data.positions.byteLength +
      mesh.data.normals.byteLength + mesh.data.indices.byteLength +
      mesh.data.mask.byteLength + mesh.data.extra.byteLength, 0) };
});
assert(meshes[1]!.triangles < meshes[0]!.triangles);
const plants = applied.added.map(index => world.props.types[index]);
const report = { map: "96×96 seed 123", template: "great-mountain-v1", sampleBytes: 2178,
  spot, chunks: chunks.length, applyMs, skins: meshes,
  shrubs: plants.filter(type => type === PROP.fieldShrub).length,
  conifers: plants.filter(type => type === PROP.coniferTree).length,
  maximumRise: Math.max(...world.heights.map((height, vertex) => height - before[vertex]!)),
  limits: "Desktop Node CPU edit/build benchmark; whole-game frame time and physical phone FPS not measured" };
const output = resolve("../resources/terrain-benchmarks/mountain-template");
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/budget.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
