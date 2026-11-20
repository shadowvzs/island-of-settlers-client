import { TERRITORY_RADII } from "../../balance/territory";
import { createMountainStoneDeposits } from "../../settlement/island-mountain-stone";
import { hasUsableOrePlot } from "../../settlement/settlement-ore-placement";
import { type Brush, getVertexRangeCells, listPaintedCells } from "../editing/brush";
import { createEditGround, type EditGround, refreshBuildLayers } from "../editing/build-refresh";
import { paintVertices } from "../editing/ground-paint";
import { addOreDeposit } from "../editing/mine-land";
import { placeProp } from "../editing/prop-placement";
import { removePropsInBrush } from "../editing/prop-removal";
import { expandRegion } from "../grid-geometry";
import { createRandom, deriveSeed } from "../rng";
import {
  BLOCKING, BUILD, MATERIAL, NO_MINE_ZONE, ORE, type Ore, PROP, SLOPE, type WorldData
} from "../world-data";
import { reservedIslandGround } from "./archipelago-rules";
import { addLateRockPropPatches } from "./ground-chain";
import { createThemeSampler } from "./theme-field";

interface Point { x: number; z: number }

/** Resources count as "home" inside the HQ territory, a mine plot's margin within its edge. */
const HOME_RESOURCE_REACH = TERRITORY_RADII[0]! - 2;
/** Ores the tutorial's metal chain needs near the HQ. */
const HOME_ORES: readonly Ore[] = [ORE.coal, ORE.iron];
/**
 * Outcrop layouts, tried in order: a full outcrop well clear of the HQ approach, the shore and the
 * harbour first; a compact one for small islands. `margin` is open land kept past the gravel
 * (mine plots reach past the ore); `shore` is the signed coast distance (vertices) kept.
 */
const OUTCROP_PROFILES = [
  { gravel: 5.5, harbour: 14, hq: 16, margin: 1.5, ore: 4.5, shore: 6 },
  { gravel: 4, harbour: 10, hq: 12, margin: 1, ore: 3.5, shore: 3 }
] as const;
type OutcropProfile = (typeof OUTCROP_PROFILES)[number];
/** Either layout inside the HQ territory first; only then the nearest site beyond it. */
const OUTCROP_PASSES = [
  ...OUTCROP_PROFILES.map(profile => ({ profile, reach: HOME_RESOURCE_REACH })),
  ...OUTCROP_PROFILES.map(profile => ({ profile, reach: Infinity }))
];
const SITE_GAP = 4;
/** Ore richness of an added deposit (generated deposits: 0.6 .. 1). */
const HOME_ORE_RICHNESS = 0.8;
/**
 * Boulder clusters on the far side from the HQ (shared meadow boulder props, batched with the
 * other stones): a quarry pile on a bare site, or a rocky rim around an ore outcrop that leaves
 * its HQ-facing side open for the mine entrance, work spot and roads. `arc`: radians covered.
 */
const BOULDER_CLUSTERS = {
  ore: { arc: 2.8, count: 6, kinds: [PROP.largeRock, PROP.smallRock], rim: 0.9 },
  stone: { arc: 1.4, count: 3, kinds: [PROP.largeRock], rim: 1.5 }
} as const;
type BoulderCluster = (typeof BOULDER_CLUSTERS)[keyof typeof BOULDER_CLUSTERS];


const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** A deposit cell of the ore with ore left inside the reach of the start. */
export const hasOreNearHome = (world: WorldData, ore: Ore, reach = HOME_RESOURCE_REACH) => {
  const { cellsX, cellsZ, start } = world;
  for (let z = Math.max(0, Math.floor(start.z - reach)); z < Math.min(cellsZ, start.z + reach); z++)
    for (let x = Math.max(0, Math.floor(start.x - reach)); x < Math.min(cellsX, start.x + reach); x++) {
      const cell = z * cellsX + x;
      if (!world.oreAmount[cell] || world.mineZones[world.mineZone[cell]! - 1]?.ore !== ore) continue;
      if (distance({ x: x + .5, z: z + .5 }, start) <= reach) return true;
    }
  return false;
};

/** Quarry stone near the start: a boulder prop or a mineable seam of mountain rock. */
export const hasStoneNearHome = (world: WorldData, reach = HOME_RESOURCE_REACH) => {
  const { props, start } = world;
  for (let index = 0; index < props.count; index++)
    if (props.types[index] === PROP.largeRock &&
      distance({ x: props.x[index]!, z: props.z[index]! }, start) <= reach) return true;
  return createMountainStoneDeposits(world).targets(start, reach).length > 0;
};

/** Cells connected to the start over land (4-neighbour flood fill). */
export const floodStartLand = (world: WorldData) => {
  const { cellsX, cellsZ } = world;
  const reached = new Uint8Array(cellsX * cellsZ);
  const first = Math.floor(world.start.z) * cellsX + Math.floor(world.start.x);
  const queue = [first];
  reached[first] = 1;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!, x = cell % cellsX;
    for (const next of [x > 0 ? cell - 1 : -1, x < cellsX - 1 ? cell + 1 : -1, cell - cellsX, cell + cellsX]) {
      if (next < 0 || next >= reached.length || reached[next] || world.blocking[next] === BLOCKING.water) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }
  return reached;
};

const isReservedGround = (world: WorldData, x: number, z: number) =>
  world.playableIslands?.sites.some(site => reservedIslandGround(site, x, z, 2)) ?? false;

/** Flat, dry, open, mine-free land around the site, clear of the shore and the reserved plots. */
const isOpenOutcropGround = (
  world: WorldData, land: Uint8Array, site: Point, profile: OutcropProfile
) => {
  const radius = profile.gravel + profile.margin, stride = world.cellsX + 1;
  for (let z = Math.floor(site.z - radius); z <= site.z + radius; z++)
    for (let x = Math.floor(site.x - radius); x <= site.x + radius; x++) {
      if (x < 1 || z < 1 || x >= world.cellsX - 1 || z >= world.cellsZ - 1) return false;
      if (distance({ x: x + .5, z: z + .5 }, site) > radius) continue;
      const cell = z * world.cellsX + x;
      if (!land[cell] || world.blocking[cell] === BLOCKING.cliff || world.mineZone[cell] !== NO_MINE_ZONE) return false;
      if (world.buildCap[cell]! < BUILD.large || world.slopeClass[cell]! > SLOPE.gentle) return false;
      if (world.coastDistance[z * stride + x]! < profile.shore || isReservedGround(world, x + .5, z + .5)) return false;
    }
  return true;
};

/** Outcrop sites nearest the start first; never on the HQ approach or the harbour frontage. */
const listOutcropSites = (world: WorldData, profile: OutcropProfile) => {
  const harbour = world.playableIslands?.sites[0]?.harbour;
  const sites: Point[] = [];
  for (let z = 2; z < world.cellsZ - 2; z += 2)
    for (let x = 2; x < world.cellsX - 2; x += 2) {
      const site = { x: x + .5, z: z + .5 };
      if (distance(site, world.start) < profile.hq + profile.gravel) continue;
      if (harbour && distance(site, harbour) < profile.harbour + profile.gravel) continue;
      sites.push(site);
    }
  return sites.sort((a, b) => distance(a, world.start) - distance(b, world.start) || a.z - b.z || a.x - b.x);
};

/** A gravel ore deposit at the site; refused (nothing painted) when no mine plot would fit. */
const placeOreOutcrop = (
  world: WorldData, ground: EditGround, site: Point, profile: OutcropProfile, ore: Ore
) => {
  const deposit: Brush = { radius: profile.ore, softness: .5, ...site };
  removePropsInBrush(world, { ...deposit, radius: profile.gravel + profile.margin }, () => true);
  if (!hasUsableOrePlot(world, listPaintedCells(world, deposit).map(({ cell }) => cell), ore)) return false;
  addOreDeposit(world, deposit, ore, HOME_ORE_RICHNESS);
  const vertices = paintVertices(world, { ...site, material: MATERIAL.mine, radius: profile.gravel,
    softness: .6, strength: 1 });
  refreshBuildLayers(world, ground, expandRegion(world, getVertexRangeCells(world, vertices), 1));
  return true;
};

/** A boulder cluster around the site on its far side from the HQ, within the reach. */
const placeBoulders = (
  world: WorldData, site: Point, cluster: BoulderCluster, rim: number, reach: number
) => {
  const random = createRandom(deriveSeed(world.seed, `home-boulders-${site.x}-${site.z}`));
  const away = Math.atan2(site.z - world.start.z, site.x - world.start.x);
  const { arc, count, kinds } = cluster;
  let placed = 0;
  for (let attempt = 0; attempt < count * 3 && placed < count; attempt++) {
    const share = count > 1 ? (attempt % count) / (count - 1) - .5 : 0;
    const angle = away + share * arc + (random() - .5) * .25;
    const offset = rim + cluster.rim + Math.floor(attempt / count) * .7 + random() * .4;
    const spot = { x: site.x + Math.cos(angle) * offset, z: site.z + Math.sin(angle) * offset };
    const kind = kinds[attempt % kinds.length]!;
    const seed = Math.floor(random() * 2 ** 31);
    if (distance(spot, world.start) > reach) continue;
    if (typeof placeProp(world, { kind, seed, ...spot }) === "number") placed++;
  }
  return placed > 0;
};

/** Outcrops on the nearest free sites until nothing is missing (inside the HQ territory first). */
const addOutcrops = (world: WorldData, missing: { ores: Ore[]; stone: boolean }) => {
  const land = floodStartLand(world), ground = createEditGround(world), used: Point[] = [];
  for (const { profile, reach } of OUTCROP_PASSES) {
    const spacing = 2 * (profile.gravel + profile.margin) + SITE_GAP;
    for (const site of listOutcropSites(world, profile)) {
      if (missing.ores.length === 0 && !missing.stone) return;
      if (distance(site, world.start) > reach) break;
      if (used.some(other => distance(site, other) < spacing)) continue;
      if (!isOpenOutcropGround(world, land, site, profile)) continue;
      const ore = missing.ores[0];
      if (ore !== undefined && !placeOreOutcrop(world, ground, site, profile, ore)) continue;
      if (ore !== undefined) missing.ores.shift();
      const boulders = ore === undefined ? BOULDER_CLUSTERS.stone : BOULDER_CLUSTERS.ore;
      const placed = placeBoulders(world, site, boulders, ore === undefined ? 0 : profile.ore, reach);
      if (placed && boulders.kinds[0] === PROP.largeRock) missing.stone = false;
      used.push(site);
    }
  }
};

/**
 * Home island guarantee (generation, deterministic per seed): coal and iron deposits and quarry
 * stone near the HQ. Missing ones get a small gravel ore outcrop (boulders on its far side)
 * on the nearest open land clear of the HQ approach, the shore and the harbour. Islands that
 * already have them stay untouched. Returns whether anything was added.
 */
export const ensureHomeResources = (world: WorldData) => {
  const missing = {
    ores: HOME_ORES.filter(ore => !hasOreNearHome(world, ore)),
    stone: !hasStoneNearHome(world)
  };
  if (missing.ores.length === 0 && !missing.stone) return false;
  const revision = world.buildRevision, firstProp = world.props.count;
  addOutcrops(world, missing);
  addLateRockPropPatches(world, world.seed, { first: firstProp, props: world.props, splat: world.splat },
    createThemeSampler(world, world.themeWeights));
  // Generation edits are part of the fresh world, not later changes the overlays redraw for.
  world.buildRevision = revision;
  return true;
};
