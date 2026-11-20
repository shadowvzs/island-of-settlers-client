import type { StatefulRandom } from "../../../shared/world/rng";
import { initVisualMotion } from "../sim/animal-animation";
import { pickSimulationMotion } from "../sim/animal-pool";
import { applyIdentity, FOREST_STEPS } from "../sim/animal-spawn";
import { HOME_RANGE, restoreRoutine, routineWaypoints } from "../sim/dormant-routine";
import type { AnimalManagerState } from "./animal-manager-state";
import type { AnimalModes } from "./animal-modes";
import {
  ANIMAL_CAPACITY,
  type AnimalSaveState,
  createColumnTemplates,
  decodeDormantColumns,
  decodeRegionColumns,
  decodeSlotColumns,
  decodeSlotTable,
  DORMANT_COLUMNS,
  type DormantColumns,
  type SavedColumns,
  SLOT_MODE,
  viewEntries,
  WILDLIFE_RULES_VERSION
} from "./animal-save-columns";
import type { AnimalSpawner } from "./animal-spawner";
import { type ColumnArray, encodeTypedColumn } from "./typed-column";

export { type AnimalSaveState, WILDLIFE_RULES_VERSION } from "./animal-save-columns";

/** More regions than any island has (1024² has 1,024): the bound when no world is known. */
const MAX_REGIONS = 1 << 16;

/** The values of `source`'s arrays for `slots` (each slot's stride), as columns. */
const gatherColumns = (source: object, slots: readonly number[], capacity: number): SavedColumns =>
  Object.fromEntries(viewEntries(source).map(([key, array]) => {
    const stride = array.length / capacity;
    const gathered = new (array.constructor as new (length: number) => ColumnArray)(slots.length * stride);
    slots.forEach((slot, position) =>
      gathered.set(array.subarray(slot * stride, slot * stride + stride), position * stride));
    return [key, encodeTypedColumn(gathered)];
  }));

/** Writes decoded columns back into `target`'s arrays at their slots. */
const scatterColumns = (
  target: object, columns: Record<string, ColumnArray>, slots: ArrayLike<number>, capacity: number
) => {
  for (const [key, array] of viewEntries(target)) {
    const stride = array.length / capacity, column = columns[key]!;
    for (let position = 0; position < slots.length; position += 1) {
      array.set(column.subarray(position * stride, position * stride + stride), slots[position]! * stride);
    }
  }
};

const isOccupied = (state: AnimalManagerState, slot: number) =>
  state.identity.dormant[slot] === 1 || state.pool.active[slot] === 1 || state.pool.carcass[slot] === 1 ||
  state.pool.departing[slot] === 1;

const saveDormant = (state: AnimalManagerState, slots: readonly number[]): SavedColumns => {
  const { dormant, pool } = state;
  const columns = Object.fromEntries(Object.entries(DORMANT_COLUMNS).map(([key, constructor]) => {
    const source = key in dormant ? dormant[key as keyof typeof dormant] : pool[key as keyof typeof pool];
    const values = new constructor(slots.length);
    slots.forEach((slot, position) => { values[position] = (source as ArrayLike<number>)[slot]!; });
    return [key, encodeTypedColumn(values)];
  }));
  const points = slots.flatMap((slot) => Array.from(routineWaypoints(dormant, slot)));
  return { ...columns, waypoints: encodeTypedColumn(Float32Array.from(points)) };
};

/** The island's wildlife as version 2 columns: O(animals), nothing derived (design §8). */
export const saveAnimals = (state: AnimalManagerState, spawner: AnimalSpawner, modes: AnimalModes): AnimalSaveState => {
  const { capacity, context, identity, ledger } = state;
  const occupied = Array.from({ length: capacity }, (_, slot) => slot).filter((slot) => isOccupied(state, slot));
  const simulated = occupied.filter((slot) => !identity.dormant[slot]);
  const sleeping = occupied.filter((slot) => identity.dormant[slot]);
  const values = (source: ArrayLike<number>) => occupied.map((slot) => source[slot]!);
  const active = modes.saveActive(), entries = ledger.save();
  return {
    version: WILDLIFE_RULES_VERSION,
    randomState: (context.random as StatefulRandom).getState(),
    spawned: state.flags.spawned,
    tick: context.tick,
    time: context.time,
    spawner: spawner.saveState(),
    slots: {
      birth: encodeTypedColumn(Int32Array.from(values(identity.birth))),
      forest: encodeTypedColumn(Uint8Array.from(values(identity.forest))),
      index: encodeTypedColumn(Int32Array.from(occupied)),
      mode: encodeTypedColumn(Uint8Array.from(occupied, (slot) =>
        identity.dormant[slot] ? SLOT_MODE.dormant : SLOT_MODE.simulated)),
      region: encodeTypedColumn(Int32Array.from(values(identity.homeRegion)))
    },
    active: {
      history: gatherColumns(state.history, simulated, capacity),
      motion: gatherColumns(pickSimulationMotion(context.motion), simulated, capacity),
      pool: gatherColumns(state.pool, simulated, capacity)
    },
    dormant: saveDormant(state, sleeping),
    regions: { active: encodeTypedColumn(active.regions), until: encodeTypedColumn(active.until) },
    ledger: { dueTick: encodeTypedColumn(entries.dueTicks), region: encodeTypedColumn(entries.regions) }
  };
};

/**
 * Decodes and checks a whole version 2 wildlife save (version, column types and lengths, unique
 * in-range slots, modes, species, ages, finite floats, regions) before any live state changes.
 */
const decodeAnimalSave = (saved: AnimalSaveState, regionCount = MAX_REGIONS) => {
  if (!saved || saved.version !== WILDLIFE_RULES_VERSION) {
    throw new Error("Unsupported wildlife save version (Wildlife 2.0 rules)");
  }
  if (!Number.isFinite(saved.time) || !Number.isSafeInteger(saved.tick) || saved.tick < 0 ||
    !Number.isSafeInteger(saved.randomState) || typeof saved.spawned !== "boolean") {
    throw new Error("Invalid saved wildlife clocks");
  }
  const table = decodeSlotTable(saved.slots, ANIMAL_CAPACITY);
  const simulated = table.index.filter((_, position) => table.mode[position] === SLOT_MODE.simulated);
  const sleeping = table.index.filter((_, position) => table.mode[position] === SLOT_MODE.dormant);
  const templates = createColumnTemplates();
  const active = saved.active ?? fail();
  const columns = {
    history: decodeSlotColumns(active.history, templates.history, simulated.length, ANIMAL_CAPACITY),
    motion: decodeSlotColumns(active.motion, templates.motion, simulated.length, ANIMAL_CAPACITY),
    pool: decodeSlotColumns(active.pool, templates.pool, simulated.length, ANIMAL_CAPACITY)
  };
  if (!columns.pool.group!.every((leader) => leader >= 0 && leader < ANIMAL_CAPACITY)) fail();
  const dormant = decodeDormantColumns(saved.dormant, sleeping.length, ANIMAL_CAPACITY);
  const regions = decodeRegionColumns(saved, regionCount);
  if (!table.region.every((region) => region < regionCount)) fail();
  validateSpawner(saved.spawner);
  return { columns, dormant, regions, simulated, sleeping, table };
};

const fail = (): never => {
  throw new Error("Invalid saved wildlife state");
};

const validateSpawner = (spawner: AnimalSaveState["spawner"]) => {
  const valid = spawner && Number.isSafeInteger(spawner.births) && Number.isFinite(spawner.respawnTimer) &&
    Number.isFinite(spawner.nextAppearanceTime) && Array.isArray(spawner.waiting) &&
    spawner.waiting.every((entry) => entry && [entry.species, entry.timer, entry.x, entry.z].every(Number.isFinite));
  if (!valid) throw new Error("Invalid saved wildlife lifecycle");
};

/** A dormant slot again: identity from its seeds, home and herd, then the anchored routine. */
const restoreDormant = (state: AnimalManagerState, slot: number, dormant: DormantColumns, position: number,
  waypointStart: number) => {
  const { context, identity, pool } = state;
  const species = dormant.species[position]!;
  const birth = { age: dormant.ageAtAnchor[position]!, birth: identity.birth[slot]!,
    forest: identity.forest[slot]! / FOREST_STEPS, sex: dormant.sex[position]! };
  applyIdentity(context, slot, species, birth);
  identity.dormant[slot] = 1;
  pool.group[slot] = dormant.group[position]!;
  pool.homeX[slot] = dormant.homeX[position]!;
  pool.homeZ[slot] = dormant.homeZ[position]!;
  pool.homeRange[slot] = HOME_RANGE;
  const count = dormant.waypointCount[position]!;
  restoreRoutine(state.dormant, slot, {
    age: birth.age, anchorTick: dormant.anchorTick[position]!, appear: dormant.appearAtAnchor[position]!,
    heading: dormant.anchorHeading[position]!, routineSeed: dormant.routineSeed[position]!,
    waypoints: dormant.waypoints.subarray(waypointStart, waypointStart + count * 2)
  }, species, pool.speedFactor[slot]!);
};

/** Restores a validated version 2 save into the live state (fresh pools; counters derive at start). */
export const restoreAnimals = (
  state: AnimalManagerState, saved: AnimalSaveState, spawner: AnimalSpawner, modes: AnimalModes
) => {
  const decoded = decodeAnimalSave(saved, state.regions.count);
  const { capacity, context, identity } = state;
  const { table } = decoded;
  table.index.forEach((slot, position) => {
    identity.birth[slot] = table.birth[position]!;
    identity.forest[slot] = table.forest[position]!;
    identity.homeRegion[slot] = table.region[position]!;
  });
  scatterColumns(state.pool, decoded.columns.pool, decoded.simulated, capacity);
  scatterColumns(pickSimulationMotion(context.motion), decoded.columns.motion, decoded.simulated, capacity);
  scatterColumns(state.history, decoded.columns.history, decoded.simulated, capacity);
  let waypointStart = 0;
  decoded.sleeping.forEach((slot, position) => {
    restoreDormant(state, slot, decoded.dormant, position, waypointStart);
    waypointStart += decoded.dormant.waypointCount[position]! * 2;
  });
  for (let animal = 0; animal < capacity; animal++) initVisualMotion(context, animal);
  context.time = saved.time;
  context.tick = saved.tick;
  (context.random as StatefulRandom).setState(saved.randomState);
  spawner.loadState(saved.spawner);
  modes.loadActive({ regions: decoded.regions.regions, until: decoded.regions.until });
  state.ledger.load(decoded.regions.ledgerRegions, decoded.regions.dueTicks);
  state.flags.spawned = saved.spawned;
  state.recountPopulation();
};

/** Validates a wildlife save without generating live animals (loading checks). */
export const validateAnimalSave = (saved: AnimalSaveState) => {
  decodeAnimalSave(saved);
};
