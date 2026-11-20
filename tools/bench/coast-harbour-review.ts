import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../../src/app/map-generator/helpers";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { BLOCKING, SLOPE, type WorldData } from "../../src/shared/world/world-data";
import { encodePng } from "../dev/png";

/**
 * COAST-NATURAL / HARBOUR-SPOTS review (Node only, no browser): top-down coast maps with the HQ,
 * the generation harbour proof and the stored harbour spots, plus per-island coast statistics.
 * Run from `island-of-settlers-client/`:
 *   OUT_DIR=<dir> PREFIX=before SEEDS=1234,42,7 CONFIGS="256x1;512x3" npx tsx tools/bench/coast-harbour-review.ts
 * A config is `<size>x<islands>`; QUERY appends generator query parameters (e.g. `&harbourSpots=1`).
 */
const outDir = process.env.OUT_DIR ?? "/tmp/coast-harbour-review";
const prefix = process.env.PREFIX ?? "run";
const seeds = (process.env.SEEDS ?? "1234,42,7").split(",").map(Number);
const configs = (process.env.CONFIGS ?? "256x1;512x3").split(";").map(entry => entry.split("x").map(Number));
const extraQuery = process.env.QUERY ?? "";
const TARGET_PIXELS = 768;

type Rgb = readonly [number, number, number];
const SEA_DEEP: Rgb = [24, 58, 112];
const SEA_SHALLOW: Rgb = [70, 150, 190];
const SAND: Rgb = [222, 204, 150];
const LOW_LAND: Rgb = [92, 150, 70];
const HIGH_LAND: Rgb = [128, 110, 84];
const HQ: Rgb = [220, 30, 30];
const PROOF: Rgb = [250, 220, 20];
const SPOT: Rgb = [230, 40, 230];

const mix = (from: Rgb, to: Rgb, amount: number): Rgb => {
  const t = Math.max(0, Math.min(1, amount));
  return [0, 1, 2].map(index => from[index]! + (to[index]! - from[index]!) * t) as unknown as Rgb;
};

const showSteep = process.env.STEEP === "1";
const STEEP: Rgb = [200, 60, 20];
const cellColour = (world: WorldData, x: number, z: number): Rgb => {
  const height = world.heights[z * (world.cellsX + 1) + x]!;
  if (world.blocking[z * world.cellsX + x] === BLOCKING.water) return mix(SEA_SHALLOW, SEA_DEEP, -height / 4);
  if (showSteep && world.slopeClass[z * world.cellsX + x]! >= SLOPE.steep) return STEEP;
  if (height < .7) return SAND;
  return mix(LOW_LAND, HIGH_LAND, (height - .7) / 12);
};

const paintMarker = (rgba: Uint8Array, size: number, scale: number, point: { x: number; z: number }, colour: Rgb,
  radius: number) => {
  const centreX = Math.round(point.x * scale), centreZ = Math.round(point.z * scale);
  for (let z = centreZ - radius; z <= centreZ + radius; z++) for (let x = centreX - radius; x <= centreX + radius; x++) {
    if (x < 0 || z < 0 || x >= size || z >= size) continue;
    const border = Math.abs(x - centreX) === radius || Math.abs(z - centreZ) === radius;
    const pixel = (z * size + x) * 4;
    rgba.set(border ? [0, 0, 0, 255] : [...colour, 255], pixel);
  }
};

const renderTopDown = (world: WorldData) => {
  const scale = Math.max(1, Math.floor(TARGET_PIXELS / Math.max(world.cellsX, world.cellsZ)));
  const width = world.cellsX * scale, height = world.cellsZ * scale;
  const rgba = new Uint8Array(width * height * 4);
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
    const colour = cellColour(world, x, z);
    for (let dz = 0; dz < scale; dz++) for (let dx = 0; dx < scale; dx++)
      rgba.set([...colour, 255], ((z * scale + dz) * width + x * scale + dx) * 4);
  }
  const marker = Math.max(2, scale * 2);
  for (const site of world.playableIslands?.sites ?? []) {
    paintMarker(rgba, width, scale, site.headquarters, HQ, marker);
    for (const spot of site.harbourSpots ?? []) paintMarker(rgba, width, scale, spot, SPOT, marker);
    paintMarker(rgba, width, scale, site.harbour, PROOF, Math.max(1, marker - 1));
  }
  return encodePng(width, height, rgba);
};

/** Land cells and land/water edges of the component holding each island centre. */
const islandShape = (world: WorldData, centre: { x: number; z: number }) => {
  const land = (x: number, z: number) => x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ &&
    world.blocking[z * world.cellsX + x] !== BLOCKING.water;
  const first = Math.floor(centre.z) * world.cellsX + Math.floor(centre.x);
  const seen = new Uint8Array(world.cellsX * world.cellsZ), queue = [first];
  seen[first] = 1;
  let edges = 0, steepCoast = 0, coast = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !land(x + dx!, z + dz!));
    if (shore) { coast++; if (world.slopeClass[cell]! >= SLOPE.steep) steepCoast++; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (!land(nx, nz)) { edges++; continue; }
      const next = nz * world.cellsX + nx;
      if (seen[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  // A digitised circle has edges = 8r, area = pi r^2: normalise so a circle scores 1.
  const circleEdges = 8 * Math.sqrt(queue.length / Math.PI);
  return { area: queue.length, edges, irregularity: Number((edges / circleEdges).toFixed(3)),
    steepCoast: Number((steepCoast / Math.max(1, coast)).toFixed(3)) };
};

const reviewWorld = (size: number, islands: number, seed: number) => {
  const query = new URLSearchParams(`size=${size}&landform=archipelago&islandCount=${islands}${extraQuery}`);
  const options = { ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(readIslandChoice(query, DEFAULT_ISLAND_CHOICE)), seed };
  const started = performance.now();
  const world = generateWorld(options);
  const milliseconds = Math.round(performance.now() - started);
  const name = `${prefix}-${size}x${islands}-${seed}`;
  writeFileSync(join(outDir, `${name}.png`), renderTopDown(world));
  const sites = (world.playableIslands?.sites ?? []).map(site => ({
    radius: site.radius, spots: site.harbourSpots?.length ?? 0, ...islandShape(world, site)
  }));
  return { name, milliseconds, seed: world.seed, sites };
};

mkdirSync(outDir, { recursive: true });
const report = [];
for (const [size, islands] of configs) for (const seed of seeds) {
  const entry = reviewWorld(size!, islands!, seed);
  console.log(JSON.stringify(entry));
  report.push(entry);
}
writeFileSync(join(outDir, `${prefix}-report.json`), JSON.stringify(report, null, 2));
