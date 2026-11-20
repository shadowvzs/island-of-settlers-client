import { readFile, writeFile } from "node:fs/promises";

import { fishingSites } from "../../src/shared/settlement/settlement-fishing";
import { makeBuilding, placementReason } from "../../src/shared/settlement/settlement-placement";
import type { SettlementContext } from "../../src/shared/settlement/settlement-types";
import { applyStampChanges } from "../../src/shared/world/editing/terrain/terrain-apply";
import type { TerrainBrushStroke } from "../../src/shared/world/editing/terrain/terrain-brush";
import { createTerrainEditState } from "../../src/shared/world/editing/terrain/terrain-edit-state";
import { readMapFile } from "../../src/shared/world/save/map-reader";
import { writeMapFile } from "../../src/shared/world/save/map-writer";

const [input, output] = process.argv.slice(2);
if (!input || !output || input === output) throw new Error("Provide separate input and output .island paths");
const loaded = await readMapFile(await readFile(input));
const world = loaded.world, stride = world.cellsX + 1;
const strokes: TerrainBrushStroke[] = [];
// Follow the existing southern coastline; retain the rest of this authored map.
for (let x = 8; x < world.cellsX - 8; x += 6) {
  let z = world.cellsZ - 1;
  while (z > 0 && world.heights[z * stride + x]! <= world.seaLevel + .2) z--;
  if (z < world.cellsZ * .8) continue;
  strokes.push({ x, z, radius: 16, mode: "beach" });
}
if (!strokes.length) throw new Error("No southern coast found");
const state = loaded.terrain ?? createTerrainEditState();
applyStampChanges(world, state, [], null, strokes);
const context = { options: { world, roads: { route: () => null, addRoad: () => {}, upgradeRoad: () => {} } },
  buildings: [], actors: [], occupied: new Uint8Array(world.cellsX * world.cellsZ), reservations: new Set(),
  nextBuilding: 0, nextActor: 0, settlers: 0, resourceAmounts: new Map(), accumulator: 0, scheduling: 0,
  transfers: [] } as SettlementContext;
const harbours: { x: number; z: number; rotation: number }[] = [];
let fishable = 0;
for (const stroke of strokes) {
  for (let z = Math.max(8, stroke.z - 18); z < Math.min(world.cellsZ - 8, stroke.z + 5); z += 2)
    for (let x = Math.max(8, stroke.x - 8); x < Math.min(world.cellsX - 8, stroke.x + 8); x += 2) {
      fishable += fishingSites(context, { id: 1, kind: "fish", x, z }).length;
      if (harbours.length >= 4) continue;
      for (let rotation = 0; rotation < 4; rotation++)
        if (!placementReason(context, makeBuilding(context, 39, x, z, rotation))) {
          harbours.push({ x, z, rotation }); break;
        }
    }
}
if (!harbours.length || !fishable) throw new Error(`Shore proof failed: ${harbours.length} harbours, ${fishable} fishing sites`);
const bytes = await writeMapFile(world, { ...loaded.meta, name: `${loaded.meta.name} — smooth beaches`,
  savedAt: Date.now(), animals: loaded.animals, terrain: state });
const roundTrip = await readMapFile(bytes);
if (roundTrip.world.heights.some((height, i) => height !== world.heights[i])) throw new Error("Height round-trip mismatch");
await writeFile(output, bytes);
console.log(JSON.stringify({ input, output, strokes, harbours, fishable, bytes: bytes.length }, null, 2));
