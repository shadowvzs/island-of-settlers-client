import { readFile } from "node:fs/promises";

import { readGameSave } from "../../src/shared/settlement/game-save";
import { levelRoadGround } from "../../src/shared/settlement/road-ground-leveling";
import { readMapFile } from "../../src/shared/world/save/map-reader";

const [mapPath, savePath] = process.argv.slice(2);
if (!mapPath || !savePath) throw new Error("Provide original .island and exported game .json");
const original = (await readMapFile(await readFile(mapPath))).world;
const game = await readGameSave(JSON.parse(await readFile(savePath, "utf8")));
const world = game.map.world;
if (world.seed !== original.seed) throw new Error("Map seeds differ");
const stride = world.cellsX + 1;
const changes = Array.from(world.heights, (height, i) => ({ x: i % stride, z: Math.floor(i / stride),
  original: original.heights[i]!, saved: height, difference: height - original.heights[i]! }))
  .filter(point => Math.abs(point.difference) > .001).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
const near = changes.filter(point => point.x >= 118 && point.x <= 128 && point.z >= 118 && point.z <= 130);
const summary = (heights: Float32Array) => ({ min: Math.min(...heights), max: Math.max(...heights) });
const before = world.heights.slice();
const reloads = [];
for (let i = 0; i < 3; i++) {
  levelRoadGround(world, game.settlement.roads, game.settlement.buildings, false);
  let vertex = 0;
  for (let j = 1; j < before.length; j++) if (Math.abs(world.heights[j]! - before[j]!) > Math.abs(world.heights[vertex]! - before[vertex]!)) vertex = j;
  reloads.push({ ...summary(world.heights), largestChange: Math.abs(world.heights[vertex]! - before[vertex]!),
    location: { x: vertex % stride, z: Math.floor(vertex / stride), before: before[vertex], after: world.heights[vertex] } });
}
console.log(JSON.stringify({ seed: world.seed, original: summary(original.heights), saved: summary(before),
  changedVertices: changes.length, largestChanges: changes.slice(0, 12), guardhouseArea: near.slice(0, 12),
  buildings: game.settlement.buildings.map(b => ({ uid: b.uid, type: b.typeId, x: b.x, z: b.z, y: b.y, access: b.access })),
  reloads }, null, 2));
