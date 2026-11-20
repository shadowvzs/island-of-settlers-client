import { MAX_PATH_POINTS } from "../nav/nav-path";
import { ISLAND_ANIMAL_CAP } from "../population/wildlife-regions";
import { PLACED_ANIMAL_SLOTS } from "../sim/animal-placement";
import {
  createAnimalHistory,
  createAnimalPool,
  createMotionPool,
  pickSimulationMotion
} from "../sim/animal-pool";
import { MAX_WAYPOINTS } from "../sim/dormant-routine";
import { SPECIES_COUNT } from "../wildlife-species";
import { type ColumnArray, type ColumnConstructor, decodeTypedColumn, type TypedColumn } from "./typed-column";

/** Wildlife rules and save shape (Wildlife 2.0, S10): saves of other versions are rejected. */
export const WILDLIFE_RULES_VERSION = 2;
/** Every island has the same pool: the region slots, then the editor placed animals. */
export const ANIMAL_CAPACITY = ISLAND_ANIMAL_CAP + PLACED_ANIMAL_SLOTS;
/** Slot modes in a save. */
export const SLOT_MODE = { simulated: 1, dormant: 2 } as const;

export type SavedColumns = Record<string, TypedColumn>;

/** The version 2 wildlife section: exact binary columns of the occupied slots (design §8). */
export interface AnimalSaveState {
  version: typeof WILDLIFE_RULES_VERSION;
  randomState: number;
  /** The island's first population was born (a later load reconciles instead). */
  spawned: boolean;
  tick: number;
  time: number;
  spawner: {
    births: number;
    nextAppearanceTime: number;
    respawnTimer: number;
    waiting: { species: number; timer: number; x: number; z: number }[];
  };
  /** Every occupied slot (ascending): birth, coat forest bias, home region, mode. */
  slots: SavedColumns;
  /** Simulated slots (ascending): pool, simulation motion and history columns. */
  active: { history: SavedColumns; motion: SavedColumns; pool: SavedColumns };
  /** Dormant slots (ascending): anchor, identity and waypoints (count per slot, flattened). */
  dormant: SavedColumns;
  /** Simulated regions and the tick their hold ends. */
  regions: SavedColumns;
  ledger: SavedColumns;
}

/** The columns a dormant slot keeps (everything else derives from seeds and the routine). */
export const DORMANT_COLUMNS = {
  ageAtAnchor: Float32Array,
  anchorHeading: Float32Array,
  anchorTick: Int32Array,
  appearAtAnchor: Float32Array,
  group: Int16Array,
  homeX: Float32Array,
  homeZ: Float32Array,
  routineSeed: Int32Array,
  sex: Uint8Array,
  species: Uint8Array,
  waypointCount: Uint8Array
} as const;

export type DormantColumns = { [Key in keyof typeof DORMANT_COLUMNS]: InstanceType<(typeof DORMANT_COLUMNS)[Key]> } & {
  waypoints: Float32Array;
};

/** Pool, motion and history arrays a save restores into (types and strides per slot). */
export const createColumnTemplates = (capacity = ANIMAL_CAPACITY) => ({
  history: createAnimalHistory(capacity),
  motion: pickSimulationMotion(createMotionPool(capacity)),
  pool: createAnimalPool(capacity)
});

export const viewEntries = (source: object) =>
  Object.entries(source).filter((entry): entry is [string, ColumnArray] => ArrayBuffer.isView(entry[1]));

const fail = (what: string): never => {
  throw new Error(`Invalid saved wildlife ${what}`);
};

/** Pool flags and small enumerations that must stay in range. */
const INTEGER_LIMITS: Record<string, number> = {
  active: 1, carcass: 1, departing: 1, huntState: 3, pathCount: MAX_PATH_POINTS,
  pathIndex: MAX_PATH_POINTS, pending: 1, reaction: 2, secondHand: 1, sex: 1, species: SPECIES_COUNT - 1
};

const checkValues = (key: string, view: ColumnArray) => {
  if (view instanceof Float32Array) {
    for (const value of view) {
      if (Number.isFinite(value) || (key === "stateLength" && value === Infinity)) continue;
      fail(`float ${key}`);
    }
    return;
  }
  const limit = INTEGER_LIMITS[key];
  if (limit !== undefined && view.some((value) => value < 0 || value > limit)) fail(`integer ${key}`);
};

/** Decodes the columns of `source` (types and strides of `templates`) for `count` slots. */
export const decodeSlotColumns = (saved: unknown, templates: object, count: number, capacity: number) => {
  if (!saved || typeof saved !== "object") fail("columns");
  const columns: Record<string, ColumnArray> = {};
  for (const [key, template] of viewEntries(templates)) {
    const stride = template.length / capacity;
    const view = decodeTypedColumn((saved as SavedColumns)[key], template.constructor as ColumnConstructor,
      count * stride);
    checkValues(key, view);
    columns[key] = view;
  }
  return columns;
};

const isAscendingSlots = (index: Int32Array, capacity: number) =>
  index.every((slot, position) => slot >= 0 && slot < capacity && (position === 0 || slot > index[position - 1]!));

/** The occupied slot table: ascending unique slots, known modes, dormant only in region slots. */
export const decodeSlotTable = (saved: unknown, capacity: number) => {
  const columns = saved as SavedColumns;
  const index = decodeTypedColumn(columns?.index, Int32Array);
  const length = index.length;
  const table = {
    birth: decodeTypedColumn(columns.birth, Int32Array, length),
    forest: decodeTypedColumn(columns.forest, Uint8Array, length),
    index,
    mode: decodeTypedColumn(columns.mode, Uint8Array, length),
    region: decodeTypedColumn(columns.region, Int32Array, length)
  };
  if (!isAscendingSlots(index, capacity)) fail("slots");
  for (let position = 0; position < length; position += 1) {
    const mode = table.mode[position]!, region = table.region[position]!;
    if (mode !== SLOT_MODE.simulated && mode !== SLOT_MODE.dormant) fail("slot mode");
    if (region < -1 || table.birth[position]! < 0) fail("slot identity");
    if (mode === SLOT_MODE.dormant && (index[position]! >= ISLAND_ANIMAL_CAP || region < 0)) fail("dormant slot");
  }
  return table;
};

/** Dormant anchors: species, sex, ages and fades in range, finite poses, 1..5 waypoints each. */
export const decodeDormantColumns = (saved: unknown, count: number, capacity: number): DormantColumns => {
  if (!saved || typeof saved !== "object") fail("dormant columns");
  const columns = saved as SavedColumns;
  const decoded = Object.fromEntries(Object.entries(DORMANT_COLUMNS).map(([key, constructor]) =>
    [key, decodeTypedColumn(columns[key], constructor, count)])) as Omit<DormantColumns, "waypoints">;
  let points = 0;
  for (let position = 0; position < count; position += 1) {
    const waypoints = decoded.waypointCount[position]!;
    const ranged = [decoded.ageAtAnchor[position]!, decoded.appearAtAnchor[position]!]
      .every((value) => value >= 0 && value <= 1);
    if (waypoints < 1 || waypoints > MAX_WAYPOINTS || !ranged || decoded.sex[position]! > 1 ||
      decoded.species[position]! >= SPECIES_COUNT || decoded.group[position]! < 0 ||
      decoded.group[position]! >= capacity) fail("dormant anchor");
    points += waypoints * 2;
  }
  const waypoints = decodeTypedColumn(columns.waypoints, Float32Array, points);
  for (const view of [decoded.anchorHeading, decoded.homeX, decoded.homeZ, waypoints]) {
    if (!view.every(Number.isFinite)) fail("dormant position");
  }
  return { ...decoded, waypoints };
};

/** Simulated regions with their hold ends, and the ledger's entries (regions below `regionCount`). */
export const decodeRegionColumns = (saved: AnimalSaveState, regionCount: number) => {
  const regions = decodeTypedColumn(saved.regions?.active, Int32Array);
  const until = decodeTypedColumn(saved.regions.until, Int32Array, regions.length);
  const ledgerRegions = decodeTypedColumn(saved.ledger?.region, Int32Array);
  const dueTicks = decodeTypedColumn(saved.ledger.dueTick, Int32Array, ledgerRegions.length);
  const inRange = (region: number) => region >= 0 && region < regionCount;
  if (!regions.every(inRange) || new Set(regions).size !== regions.length || !until.every((tick) => tick >= 0)) {
    fail("active regions");
  }
  if (!ledgerRegions.every(inRange)) fail("respawn ledger");
  return { dueTicks, ledgerRegions, regions, until };
};
