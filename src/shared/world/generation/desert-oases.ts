import { refreshBuildClassRegion } from "../build-class";
import { placeProp } from "../editing/prop-placement";
import { removePropsAt } from "../editing/prop-removal";
import { measureLake, shapeLakes } from "../editing/terrain/terrain-lakes";
import { refreshNormals } from "../lighting";
import { createRandom, deriveSeed } from "../rng";
import { COMPETITION, encodeTreeForm, PALM } from "../tree-forms";
import { BLOCKING, HEIGHT_LEVEL_STEP, MATERIAL, MATERIAL_COUNT, NO_MINE_ZONE, PROP, type WorldData } from "../world-data";
import { getCellTerrain } from "./gameplay";
import { featureCellRuns, validGeneratedFeatureIdentities } from "./generated-feature-identities";

export interface OasisProtection { contains(x: number, z: number): boolean }
const TREES = new Set<number>([PROP.palmTree, PROP.broadleafTree, PROP.birchTree, PROP.coniferTree]);
const freshWater = (world: WorldData, vertex: number) =>
  world.waterDepth[vertex]! > .03 && world.waterSurface[vertex]! > world.seaLevel + .3;

/** Small natural lake on safe inland ground; no island coast, mine, start or protected site moves. */
const addOasisLake = (world: WorldData, protection?: OasisProtection) => {
  const random = createRandom(deriveSeed(world.seed, "desert-oasis")), radius = 8;
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = Math.round(12 + random() * (world.cellsX - 24));
    const z = Math.round(12 + random() * (world.cellsZ - 24));
    if (Math.hypot(x - world.start.x, z - world.start.z) < 16) continue;
    let safe = true, low = Infinity, high = -Infinity;
    for (let dz = -radius; dz <= radius && safe; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const px = x + dx, pz = z + dz, cell = pz * world.cellsX + px;
      const vertex = pz * (world.cellsX + 1) + px, height = world.heights[vertex]!;
      if (protection?.contains(px, pz) || height < world.seaLevel + .7 ||
        world.waterDepth[vertex]! > 0 || world.mineZone[cell] !== NO_MINE_ZONE ||
        world.blocking[cell] === BLOCKING.cliff) { safe = false; break; }
      low = Math.min(low, height); high = Math.max(high, height);
    }
    if (!safe || high - low > 1.2) continue;
    const lake = measureLake(world, world, { id: 0, kind: "lake", x, z, level: 2,
      seed: deriveSeed(world.seed, "oasis-shore") });
    if (lake.sea || !Number.isFinite(lake.surface)) continue;
    const bounds = { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius };
    world.lakeWater ??= new Uint8Array(world.heights.length);
    const support = new Set<number>();
    for (let pz = bounds.minZ; pz <= bounds.maxZ; pz++) for (let px = bounds.minX; px <= bounds.maxX; px++) {
      const vertex = pz * (world.cellsX + 1) + px;
      const shaped = shapeLakes([lake], px, pz, world.heights[vertex]!);
      if (!shaped.reached) continue;
      for (const dz of [-1, 0]) for (const dx of [-1, 0]) {
        const cx = px + dx, cz = pz + dz;
        if (cx >= 0 && cz >= 0 && cx < world.cellsX && cz < world.cellsZ) support.add(cz * world.cellsX + cx);
      }
      world.heights[vertex] = shaped.height;
      world.heightLevels[vertex] = Math.max(0, Math.floor((shaped.height + .5) / HEIGHT_LEVEL_STEP));
      if (shaped.surface !== null) {
        world.waterSurface[vertex] = shaped.surface;
        world.waterDepth[vertex] = Math.max(0, shaped.surface - shaped.height);
        world.lakeWater[vertex] = 1;
      }
    }
    const identities = [...world.generatedFeatureIdentities ?? [], { version: 1 as const,
      id: 1 + Math.max(0, ...(world.generatedFeatureIdentities ?? []).map(feature => feature.id)),
      source: "oasis" as const, kind: "water" as const, x, z, runs: featureCellRuns(support) }];
    if (validGeneratedFeatureIdentities(identities, world)) world.generatedFeatureIdentities = identities;
    const submerged: number[] = [];
    for (let prop = 0; prop < world.props.count; prop++) {
      const px = Math.round(world.props.x[prop]!), pz = Math.round(world.props.z[prop]!);
      if (freshWater(world, pz * (world.cellsX + 1) + px)) submerged.push(prop);
    }
    if (submerged.length) removePropsAt(world, submerged);
    for (let pz = bounds.minZ; pz <= bounds.maxZ; pz++) for (let px = bounds.minX; px <= bounds.maxX; px++) {
      const cell = pz * world.cellsX + px, terrain = getCellTerrain(world, world, px, pz);
      world.slopeClass[cell] = terrain.slopeClass;
      if (world.blocking[cell] !== BLOCKING.prop) world.blocking[cell] = terrain.blocking;
    }
    refreshBuildClassRegion(world, bounds); refreshNormals(world, world.heights, world.normals, bounds);
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    return;
  }
};

/** Desert greenery is strictly tied to inland fresh water, never scattered unrelated green patches. */
export const applyDesertOases = (world: WorldData, protection?: OasisProtection) => {
  if (!world.heights.some((_height, vertex) => freshWater(world, vertex))) addOasisLake(world, protection);
  const water: { x: number; z: number }[] = [];
  for (let vertex = 0; vertex < world.heights.length; vertex++) if (freshWater(world, vertex))
    water.push({ x: vertex % (world.cellsX + 1), z: Math.floor(vertex / (world.cellsX + 1)) });
  const distance = (x: number, z: number) => {
    let nearest = Infinity;
    for (const point of water) nearest = Math.min(nearest, Math.hypot(x - point.x, z - point.z));
    return nearest;
  };
  for (let vertex = 0; vertex < world.heights.length; vertex++) {
    const offset = vertex * MATERIAL_COUNT;
    if (world.heights[vertex]! <= world.seaLevel + .1 || freshWater(world, vertex)) continue;
    const x = vertex % (world.cellsX + 1), z = Math.floor(vertex / (world.cellsX + 1));
    const green = Math.max(0, 1 - distance(x, z) / 3.5);
    const rock = world.splat[offset + MATERIAL.rock]!, mine = world.splat[offset + MATERIAL.mine]!;
    world.splat.fill(0, offset, offset + MATERIAL_COUNT);
    world.splat[offset + MATERIAL.rock] = rock; world.splat[offset + MATERIAL.mine] = mine;
    const available = Math.max(0, 255 - rock - mine), grass = Math.round(available * green * .85);
    world.splat[offset + MATERIAL.grass] = grass; world.splat[offset + MATERIAL.sand] = available - grass;
    world.moisture[vertex] = Math.round(green * 240);
  }
  const removed: number[] = [];
  for (let prop = 0; prop < world.props.count; prop++) {
    const type = world.props.types[prop]!;
    if (!TREES.has(type)) continue;
    if (distance(world.props.x[prop]!, world.props.z[prop]!) > 3.5) removed.push(prop);
    else { world.props.types[prop] = PROP.palmTree; world.props.form[prop] = encodeTreeForm(PALM.date, COMPETITION.open); }
  }
  if (removed.length) removePropsAt(world, removed);
  // A green oasis always has palms even when the original island's grove missed its shores.
  const random = createRandom(deriveSeed(world.seed, "oasis-palms"));
  let planted = Array.from({ length: world.props.count }, (_, id) => id).filter(id =>
    world.props.types[id] === PROP.palmTree && distance(world.props.x[id]!, world.props.z[id]!) <= 3.5).length;
  const palmTarget = world.expeditionKind === "colony" ? 20 : 8;
  for (let attempt = 0; attempt < 800 && planted < palmTarget && water.length; attempt++) {
    const point = water[Math.floor(random() * water.length)]!;
    const angle = random() * Math.PI * 2, reach = 2.5 + random() * 2;
    const x = point.x + Math.cos(angle) * reach, z = point.z + Math.sin(angle) * reach;
    const cell = Math.floor(z) * world.cellsX + Math.floor(x);
    if (distance(x, z) > 3 || distance(x, z) < .7 || protection?.contains(x, z) || !world.walkCost[cell]) continue;
    const id = placeProp(world, { kind: PROP.palmTree, x, z, seed: deriveSeed(world.seed, `oasis-palm:${attempt}`) });
    if (typeof id !== "number") continue;
    world.props.form[id] = encodeTreeForm(PALM.date, COMPETITION.open); planted++;
  }
};
