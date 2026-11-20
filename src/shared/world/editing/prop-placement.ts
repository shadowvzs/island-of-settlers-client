import { TREE_GROWTH_SECONDS } from "../../balance/economy";
import { refreshBuildClassAround } from "../build-class";
import { isBlockingProp } from "../generation/gameplay";
import { addPropWalkCost } from "../generation/walkability";
import { sampleSmooth } from "../grid-geometry";
import { propPhase, quantisePropPosition, quantisePropRotation, quantisePropScale } from "../prop-quantum";
import { createRandom, type Random } from "../rng";
import { bumpBuildRevision, markWorldCellChanged } from "../save/world-change-journal";
import { BIRCH, COMPETITION, CONIFER, encodeTreeForm, HARDWOOD, HARDWOOD_SOURCE, PALM } from "../tree-forms";
import { BLOCKING, PROP, PROP_REMOVED, SLOPE, type WorldData } from "../world-data";
import { aquaticDecorationSpot } from "./aquatic-decoration";
import type { EditRefusal } from "./edit-refusal";
import { appendProp } from "./prop-set";

/** A prop to place: its kind, the seed of its look and where it stands. */
export interface PropRequest {
  /** Initial tree age (seconds); a mature tree's random look skips young-looking forms. */
  ageSeconds?: number;
  /** Optional timber appearance: hardwood 0..8, mahogany/walnut 0..3. */
  hardwoodForm?: number;
  kind: number;
  /** Editor decoration authoring: a cell already blocked by props may hold this one too when this allows it. */
  shareBlockedCell?: (cell: number) => boolean;
  /** Seed of the prop's look (form, size, facing, sway phase). */
  seed: number;
  x: number;
  z: number;
}

/** Archetypes a placed tree picks from (open grown: it stands alone). */
const ARCHETYPES: Partial<Record<number, readonly number[]>> = {
  [PROP.birchTree]: Object.values(BIRCH),
  [PROP.coniferTree]: Object.values(CONIFER),
  [PROP.palmTree]: Object.values(PALM),
  [PROP.cedarTree]: Object.values(CONIFER),
  [PROP.mahoganyTree]: Object.values(HARDWOOD_SOURCE),
  [PROP.walnutTree]: Object.values(HARDWOOD_SOURCE),
  [PROP.hardwoodTree]: Object.values(HARDWOOD)
};

/**
 * Placement scale per kind: trees always mature (the editor places things in their final form,
 * never a sprout), stones and pebbles a little varied. Other kinds use the default.
 */
const SCALES: Partial<Record<number, { base: number; spread: number }>> = {
  [PROP.sapling]: { base: 0.85, spread: 0.3 },
  [PROP.smallRock]: { base: 0.8, spread: 0.4 },
  [PROP.largeRock]: { base: 0.9, spread: 0.4 },
  [PROP.pebbles]: { base: 0.8, spread: 0.4 }
};
export const TREE_SCALE = { base: 1.12, spread: 0.2 } as const;

/**
 * Structural forms that look like a young tree even when fully grown: the slim young birch (also a
 * hardwood appearance) and the small pygmy date / ground palms. A mature placement never picks them.
 */
const YOUNG_LOOKING_FORMS: Partial<Record<number, ReadonlySet<number>>> = {
  [PROP.birchTree]: new Set([BIRCH.young]),
  [PROP.hardwoodTree]: new Set([HARDWOOD.birchYoung]),
  [PROP.palmTree]: new Set([PALM.pygmyDate, PALM.ground])
};

/** The archetypes a random look picks from: a tree placed mature only takes mature-looking forms. */
export const getPlacementArchetypes = (kind: number, ageSeconds?: number) => {
  const archetypes = ARCHETYPES[kind];
  const young = YOUNG_LOOKING_FORMS[kind];
  if (!archetypes || !young || ageSeconds === undefined || ageSeconds < TREE_GROWTH_SECONDS) return archetypes;
  return archetypes.filter(archetype => !young.has(archetype));
};

const pickForm = (kind: number, random: Random, ageSeconds?: number) => {
  const archetypes = getPlacementArchetypes(kind, ageSeconds);
  if (!archetypes) return 0;
  const archetype = archetypes[Math.floor(random() * archetypes.length)]!;
  return encodeTreeForm(archetype, COMPETITION.open);
};

/**
 * Why a prop of the kind cannot stand at (x, z), or null when it can: outside the map, on
 * water or a cliff; a blocking kind (tree, stone) also not where another blocking prop stands.
 */
export const checkPropSpot = (
  world: WorldData,
  kind: number,
  x: number,
  z: number,
  shareBlockedCell?: (cell: number) => boolean
): EditRefusal | null => {
  if (!Number.isFinite(x) || !Number.isFinite(z) ||
    x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return "outside";
  const cell = Math.floor(z) * world.cellsX + Math.floor(x);
  const stone = kind === PROP.smallRock || kind === PROP.largeRock || kind === PROP.pebbles;
  if (stone && world.settlementGroundClearance?.[cell]) return "blocked";
  const aquatic = aquaticDecorationSpot(world, kind, x, z);
  if (aquatic) return aquatic.refusal;
  const blocking = world.blocking[cell];
  if (blocking === BLOCKING.water) return "water";
  if (blocking === BLOCKING.cliff || world.slopeClass[cell] === SLOPE.cliff) return "steep";
  if (blocking !== BLOCKING.prop || !isBlockingProp(kind)) return null;
  return shareBlockedCell?.(cell) ? null : "blocked";
};

/**
 * Places a prop (map editor: a tree, a stone, pebbles): a new prop with its form, size and
 * facing from the seed; a blocking kind blocks its cell for building, the walk cost and the
 * build class around it follow. Returns the new prop's index, or why it was refused.
 */
export const placeProp = (world: WorldData, request: PropRequest): number | EditRefusal => {
  const { kind } = request;
  const x = quantisePropPosition(request.x);
  const z = quantisePropPosition(request.z);
  const refusal = checkPropSpot(world, kind, x, z, request.shareBlockedCell);
  if (refusal) return refusal;
  const random = createRandom(request.seed);
  const size = SCALES[kind] ?? TREE_SCALE;
  const aquatic = aquaticDecorationSpot(world, kind, x, z);
  const seededForm = pickForm(kind, random, request.ageSeconds);
  const form = (kind === PROP.hardwoodTree || kind === PROP.mahoganyTree || kind === PROP.walnutTree) && Number.isInteger(request.hardwoodForm) &&
    request.hardwoodForm! >= 0 && request.hardwoodForm! < (kind === PROP.hardwoodTree ? 9 : 4) ?
    encodeTreeForm(request.hardwoodForm!, COMPETITION.open) : seededForm;
  const index = appendProp(world.props, {
    form,
    phase: 0,
    rotation: quantisePropRotation(random() * Math.PI * 2),
    scale: quantisePropScale(size.base + random() * size.spread),
    type: kind,
    x,
    y: aquatic && "y" in aquatic ? aquatic.y : sampleSmooth(world, world.heights, x, z),
    z
  });
  // Phases are derived from the seed and the spatial id, exactly as a loaded map derives them (S05b).
  world.props.phase[index] = propPhase(world.seed, index);
  occupyPropCell(world, kind, x, z);
  return index;
};

/** A placed or restored prop's cell: walk cost, and for a blocking kind the blocking and build class. */
const occupyPropCell = (world: WorldData, kind: number, x: number, z: number) => {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  const cell = cellZ * world.cellsX + cellX;
  world.walkCost[cell] = addPropWalkCost(world.walkCost[cell]!, kind);
  markWorldCellChanged(world, cell);
  if (!isBlockingProp(kind)) {
    bumpBuildRevision(world, null);
    return;
  }
  world.blocking[cell] = BLOCKING.prop;
  refreshBuildClassAround(world, cellX, cellZ);
};

/**
 * Brings a removed prop back as `kind` at its own index (same place, size, facing and look, settled on
 * the current ground): a used up quarry boulder that respawns. Returns false for a live prop.
 */
export const restoreRemovedProp = (world: WorldData, index: number, kind: number) => {
  const { props } = world;
  if (!Number.isSafeInteger(index) || index < 0 || index >= props.count || props.types[index] !== PROP_REMOVED)
    return false;
  const x = props.x[index]!, z = props.z[index]!;
  props.types[index] = kind;
  props.y[index] = sampleSmooth(world, world.heights, x, z);
  occupyPropCell(world, kind, x, z);
  return true;
};
