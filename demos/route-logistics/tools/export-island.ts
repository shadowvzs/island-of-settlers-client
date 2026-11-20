import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { stageGameSession } from "../../../src/app/settlement/game-session";
import { getBuildingDefinition } from "../../../src/render-common/buildings/building-catalog";
import type { GameSaveV1 } from "../../../src/shared/settlement/game-save";
import { getProductionRule } from "../../../src/shared/settlement/production-rules";
import { DEBUG_BUILD_ALL_TYPES } from "../../../src/shared/settlement/settlement-debug-build-all";

const [saveArg, outArg] = process.argv.slice(2);
if (!saveArg) {
  console.error("usage: tsx demos/route-logistics/tools/export-island.ts <save.json> [out.json]");
  process.exit(2);
}
const outPath = resolve(outArg ?? "demos/route-logistics/data/island.json");
const save = JSON.parse(await readFile(resolve(saveArg), "utf8")) as GameSaveV1;
const loaded = await stageGameSession(save);
const world = loaded.map.world;

const TERRAIN_SIZE = 128;
const heights = world.heights;
const waterDepth = world.waterDepth;
const cells = world.cellsX + 1;
const step = Math.max(1, Math.floor(world.cellsX / TERRAIN_SIZE));
const terrainWidth = Math.floor(world.cellsX / step);
const terrainHeight = Math.floor(world.cellsZ / step);
let minHeight = Infinity, maxHeight = -Infinity;
for (let z = 0; z < terrainHeight; z++) for (let x = 0; x < terrainWidth; x++) {
  const value = heights[(z * step) * cells + x * step]!;
  if (value < minHeight) minHeight = value;
  if (value > maxHeight) maxHeight = value;
}
const heightBytes = new Uint8Array(terrainWidth * terrainHeight);
const waterBytes = new Uint8Array(terrainWidth * terrainHeight);
for (let z = 0; z < terrainHeight; z++) for (let x = 0; x < terrainWidth; x++) {
  const cell = (z * step) * cells + x * step;
  const height = heights[cell]!, water = waterDepth[cell]!;
  heightBytes[z * terrainWidth + x] = Math.round(255 * (height - minHeight) / Math.max(1e-6, maxHeight - minHeight));
  waterBytes[z * terrainWidth + x] = water > 0.08 ? 255 : 0;
}

const hubTypes = new Set([0, 29, 39]);
const homeTypes = new Set([57, 58, 59]);
const serviceTypes = new Set([14, 20, 40]);

const roleOf = (typeId: number) => {
  if (hubTypes.has(typeId)) return "hub";
  if (homeTypes.has(typeId)) return "home";
  const rule = getProductionRule(typeId);
  if (rule?.outputs.length) return "producer";
  if (rule?.inputs.length) return "consumer";
  if (serviceTypes.has(typeId)) return "service";
  return "idle";
};

const buildings = loaded.settlement.buildings.map(building => {
  const definition = getBuildingDefinition(building.typeId);
  const rule = getProductionRule(building.typeId);
  const role = roleOf(building.typeId);
  return {
    uid: building.uid,
    typeId: building.typeId,
    name: definition.name,
    x: building.x,
    z: building.z,
    width: building.width,
    depth: building.depth,
    rotation: building.rotation,
    access: { x: building.access.x, z: building.access.z },
    role,
    inputs: rule?.inputs ?? [],
    outputs: rule?.outputs ?? [],
    seconds: rule?.seconds ?? 10,
    alternativeFood: rule?.alternativeFood ?? false,
    inventory: building.inventory ?? {},
    status: building.status ?? "",
    construction: building.construction ?? 0
  };
});

const roads = (loaded.settlement.roads ?? []).map(segment => ({
  a: { x: segment.start.x, z: segment.start.z },
  b: { x: segment.end.x, z: segment.end.z },
  tier: segment.tier ?? "dirt"
}));

const catalog = DEBUG_BUILD_ALL_TYPES.map(typeId => {
  const definition = getBuildingDefinition(typeId);
  const rule = getProductionRule(typeId);
  return {
    typeId,
    name: definition.name,
    footprint: definition.gridFootprint,
    role: roleOf(typeId),
    inputs: rule?.inputs ?? [],
    outputs: rule?.outputs ?? [],
    seconds: rule?.seconds ?? 10,
    alternativeFood: rule?.alternativeFood ?? false
  };
}).sort((first, second) => first.typeId - second.typeId);

const island = {
  source: saveArg,
  seed: world.seed,
  savedAt: save.savedAt,
  size: { cellsX: world.cellsX, cellsZ: world.cellsZ },
  terrain: {
    width: terrainWidth,
    height: terrainHeight,
    minHeight,
    maxHeight,
    heights: Buffer.from(heightBytes).toString("base64"),
    water: Buffer.from(waterBytes).toString("base64")
  },
  buildings,
  roads,
  catalog
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(island));
console.log(JSON.stringify({
  out: outPath,
  seed: island.seed,
  buildings: buildings.length,
  types: new Set(buildings.map(building => building.typeId)).size,
  roads: roads.length,
  terrain: `${terrainWidth}x${terrainHeight}`,
  bytes: JSON.stringify(island).length
}, null, 2));
