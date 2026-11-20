import {
  alignRegion,
  type CellRegion,
  expandRegion,
  isRegionEmpty} from "../../../shared/world/grid-geometry";
import { createKeyedRandom, deriveSeed, type Random } from "../../../shared/world/rng";
import { AMBIENT_DENSITY } from "../../ambient-density";
import { CHUNK_CELLS } from "../../terrain-chunks";
import type { CritterColony } from "../critter-colonies";
import { CRITTER_SPECIES, type CritterId } from "../critter-species";
import { toPoint } from "./critter-habitats";
import type { CritterTerrain } from "./critter-terrain";

/** Reference island area of a colony's `perIsland` count (256 x 256 cells). */
const REFERENCE_AREA = 256 * 256;
/** Side of the spatial buckets that index the sites (world units). */
export const SITE_BUCKET = 16;
/** Cells around an edit whose habitat scores can change (the rock and forest fields spread). */
const SCORE_REACH = 16;
/** Cells around an edit's rock chunks where the camera's view of the ground can change. */
const VIEW_REACH = 12;
const VIEW = { hidden: 2, seen: 1, unknown: 0 } as const;

/** One home of a colony: where it is, who lives there (fixed per spot) and its roll. */
export interface CritterSite {
  colony: number;
  /** Every member is hunted or fished: shown whatever the Critters setting. */
  food: boolean;
  members: readonly CritterId[];
  /** The home went with a map edit: never occupied again, its members leave (critter manager). */
  retired?: boolean;
  /** 0..1 roll: occupied while below the colony's activity (time of day, weather). */
  roll: number;
  seed: number;
  x: number;
  /** Ground or water surface height (where it shows on screen). */
  y: number;
  z: number;
}

export interface CritterSites {
  /** Site indices per bucket (row major, SITE_BUCKET units square). */
  buckets: number[][];
  bucketsX: number;
  bucketsZ: number;
  list: CritterSite[];
  /**
   * Map editor: the homes follow the edited cells (after the terrain's refresh): the habitat
   * around them is scored again and every colony's sites are taken again, exactly as a fresh
   * build of the edited island takes them. `list` and `buckets` are replaced.
   */
  refresh: (cells: CellRegion) => void;
}

/** A habitat vertex that passed its chance roll, with its rank among the colony's homes. */
interface Candidate {
  priority: number;
  vertex: number;
}

/** A colony's candidates (best priority first) and its per vertex random streams. */
interface ColonyPlan {
  candidates: Candidate[];
  colony: CritterColony;
  index: number;
  keyed: (vertex: number) => Random;
}

/** Winter keeps only the colony's share of the sites. */
const getWinterChance = (terrain: CritterTerrain, colony: CritterColony, x: number, z: number) =>
  1 - terrain.winter(x, z) * (1 - colony.winter);

const isSpaced = (accepted: CritterSite[], x: number, z: number, spacing: number) =>
  accepted.every((site) => Math.hypot(site.x - x, site.z - z) >= spacing);

const byPriority = (a: Candidate, b: Candidate) => b.priority - a.priority || a.vertex - b.vertex;

/** The vertex's own stream: the chance roll, then its priority (fixed per spot and seed). */
const rollCandidate = (terrain: CritterTerrain, plan: ColonyPlan, vertex: number) => {
  const score = plan.colony.habitat(terrain, vertex);
  if (score <= 0) return null;
  const { x, z } = toPoint(terrain.world, vertex);
  const random = plan.keyed(vertex);
  if (random() >= score * getWinterChance(terrain, plan.colony, x, z)) return null;
  return { priority: random(), vertex };
};

/** Calls `visit` for every vertex of the cells (their corners included). */
const forEachRegionVertex = (
  terrain: CritterTerrain,
  region: CellRegion,
  visit: (vertex: number) => void
) => {
  const stride = terrain.world.cellsX + 1;
  for (let vertexZ = region.minZ; vertexZ <= region.maxZ + 1; vertexZ += 1) {
    for (let vertexX = region.minX; vertexX <= region.maxX + 1; vertexX += 1) {
      visit(vertexZ * stride + vertexX);
    }
  }
};

const isVertexInside = (stride: number, region: CellRegion, vertex: number) => {
  const x = vertex % stride;
  const z = (vertex - x) / stride;
  return x >= region.minX && x <= region.maxX + 1 && z >= region.minZ && z <= region.maxZ + 1;
};

/** Two lists in priority order merged into one (the kept candidates and the rescored ones). */
const mergeByPriority = (first: Candidate[], second: Candidate[]) => {
  const merged: Candidate[] = [];
  let a = 0;
  let b = 0;
  while (a < first.length && b < second.length) {
    merged.push(byPriority(first[a]!, second[b]!) <= 0 ? first[a++]! : second[b++]!);
  }
  return merged.concat(first.slice(a), second.slice(b));
};

/** The candidates of a region's vertices (every vertex of the island without a region). */
const scoreCandidates = (terrain: CritterTerrain, plan: ColonyPlan, region: CellRegion | null) => {
  const found: Candidate[] = [];
  const add = (vertex: number) => {
    const candidate = rollCandidate(terrain, plan, vertex);
    if (candidate) found.push(candidate);
  };
  if (region) forEachRegionVertex(terrain, region, add);
  else for (let vertex = 0; vertex < terrain.world.heights.length; vertex += 1) add(vertex);
  return found;
};

/** Whether the iso camera sees the ground of a vertex (asked once, until an edit near it). */
const createViewCache = (terrain: CritterTerrain) => {
  const view = new Uint8Array(terrain.world.heights.length);
  const isHidden = (vertex: number) => {
    if (view[vertex] === VIEW.unknown) {
      const { x, z } = toPoint(terrain.world, vertex);
      view[vertex] = terrain.hidden(x, z) ? VIEW.hidden : VIEW.seen;
    }
    return view[vertex] === VIEW.hidden;
  };
  const forget = (region: CellRegion) =>
    forEachRegionVertex(terrain, region, (vertex) => (view[vertex] = VIEW.unknown));
  return { forget, isHidden };
};

type ViewCache = ReturnType<typeof createViewCache>;

/** The home at a vertex: members, roll and seed from the vertex's stream after its ranking. */
const createSite = (terrain: CritterTerrain, plan: ColonyPlan, vertex: number): CritterSite => {
  const { x, z } = toPoint(terrain.world, vertex);
  const random = plan.keyed(vertex);
  random();
  random();
  const members = plan.colony.members(random);
  const food = members.every((species) => CRITTER_SPECIES[species]!.food);
  const y = terrain.water(x, z);
  return { colony: plan.index, food, members, roll: random(), seed: random(), x, y, z };
};

/**
 * The sites of one colony: its candidates by priority, each taken when no taken site is closer
 * than the spacing (and, in sight colonies, the camera sees the spot), up to the colony's count
 * for the island's area. A pure function of the island: the same ground gives the same homes,
 * however it came about (generated, edited, loaded).
 */
const takeSites = (terrain: CritterTerrain, plan: ColonyPlan, view: ViewCache) => {
  const { colony } = plan;
  const { world } = terrain;
  const cap = Math.round((colony.perIsland * world.cellsX * world.cellsZ) / REFERENCE_AREA);
  const accepted: CritterSite[] = [];
  for (const { vertex } of plan.candidates) {
    if (accepted.length >= cap) break;
    const { x, z } = toPoint(world, vertex);
    if (!isSpaced(accepted, x, z, colony.spacing)) continue;
    if (colony.inSight && view.isHidden(vertex)) continue;
    accepted.push(createSite(terrain, plan, vertex));
  }
  // Keep food homes exactly and retain the best-ranked decorative habitats. Whole
  // families stay together, including one home for rare colonies on small islands.
  const decorativeCap = Math.ceil(accepted.length * AMBIENT_DENSITY);
  return accepted.filter((site, index) => site.food || index < decorativeCap);
};

const indexSites = (terrain: CritterTerrain, list: CritterSite[]) => {
  const bucketsX = Math.ceil(terrain.world.cellsX / SITE_BUCKET);
  const bucketsZ = Math.ceil(terrain.world.cellsZ / SITE_BUCKET);
  const buckets: number[][] = Array.from({ length: bucketsX * bucketsZ }, () => []);
  list.forEach((site, index) => {
    const bucketX = Math.min(bucketsX - 1, Math.max(0, Math.floor(site.x / SITE_BUCKET)));
    const bucketZ = Math.min(bucketsZ - 1, Math.max(0, Math.floor(site.z / SITE_BUCKET)));
    buckets[bucketZ * bucketsX + bucketX]!.push(index);
  });
  return { buckets, bucketsX, bucketsZ };
};

const createPlan = (terrain: CritterTerrain, colony: CritterColony, index: number) => {
  const seed = deriveSeed(terrain.world.seed, `critters:${colony.name}`);
  const plan: ColonyPlan = { candidates: [], colony, index, keyed: createKeyedRandom(seed) };
  plan.candidates = scoreCandidates(terrain, plan, null).sort(byPriority);
  return plan;
};

/** The region's candidates scored again, the others kept (both stay in priority order). */
const rescorePlan = (terrain: CritterTerrain, plan: ColonyPlan, region: CellRegion) => {
  const stride = terrain.world.cellsX + 1;
  const kept = plan.candidates.filter(({ vertex }) => !isVertexInside(stride, region, vertex));
  plan.candidates = mergeByPriority(kept, scoreCandidates(terrain, plan, region).sort(byPriority));
};

/** Every colony's sites of an island, indexed by area; `refresh` follows map edits. */
export const createCritterSites = (
  terrain: CritterTerrain,
  colonies: readonly CritterColony[]
): CritterSites => {
  const { world } = terrain;
  const plans = colonies.map((colony, index) => createPlan(terrain, colony, index));
  const view = createViewCache(terrain);
  const takeAll = () => {
    const list = plans.flatMap((plan) => takeSites(terrain, plan, view));
    return { list, ...indexSites(terrain, list) };
  };
  const sites: CritterSites = {
    ...takeAll(),
    refresh: (cells) => {
      if (isRegionEmpty(cells)) return;
      const scored = expandRegion(world, cells, SCORE_REACH);
      for (const plan of plans) rescorePlan(terrain, plan, scored);
      view.forget(expandRegion(world, alignRegion(world, cells, CHUNK_CELLS), VIEW_REACH));
      Object.assign(sites, takeAll());
    }
  };
  return sites;
};
