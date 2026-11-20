import {
  type MapRegion, regionContainsCell
} from "../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import type { ScriptEventKind } from "../../../../island-of-settlers-shared/src/script/catalog/events";
import {
  buildRegionCellLists, type RegionCellLists, watchedRegions
} from "../../../../island-of-settlers-shared/src/script/engine/region-watch";
import type { ScriptEmission, ScriptEventActor } from "../../../../island-of-settlers-shared/src/script/types/emission";
import type { MapScript } from "../../../../island-of-settlers-shared/src/script/types/script";
import type { SettlementActor, SettlementContext } from "../settlement/settlement-types";
import { WATCH_INITIAL_CAPACITY } from "./constants";
import { describeAnimal, type NatureGenerations } from "./nature/nature-actors";
import type { ScriptWildlifeSlots } from "./nature/nature-source";
import { wildlifeRegions } from "./nature/wildlife-pins";
import { describeUnit, type ScriptGenerations } from "./script-actors";

/**
 * Region watch (trigger design §6.4, lane TRG4): exact `enteredRegion`/`leftRegion` for units. Only regions the
 * script watches are rasterized into per-cell CSR lists; each person's cell is sampled once at the end of every
 * live tick (the tick commits positions, so this is the per-tick choke point of every movement path) and the two
 * cells' region slices are compared. Discontinuous moves (spawn, teleport, relocation, movement skip) are the
 * same comparison; despawn is the explicit `forget` call. Contained people (inside a building, aboard a ship)
 * stand in no region. One event per actor and region: `enteringActor` names the unit, `region` the region.
 * Nothing is saved: saves happen between ticks, after the sample, so a reload re-samples the same cells.
 * TRG3b: simulated animals are sampled the same way, but only against the regions an animal-subject event names
 * (the wildlife pins, kept awake, so their animals move per tick); dormant animals stand in no watched region.
 */

/** A person never sampled since the last reset (its first sample enters its regions: spawn-inside counts). */
const UNSEEN = -2;
/** Inside a building, aboard a ship or off the map: in no region. */
export const NOWHERE = -1;

const ABOARD_PHASE = "navalAboard";

/** Contained people are hidden behind a door or ride on a deck (design §6.4). */
export const isContained = (actor: Pick<SettlementActor, "phase" | "visible">) =>
  !actor.visible || actor.phase === ABOARD_PHASE;

/** A spot the region rules test: contained objects stand in no region. */
export interface RegionSpot {
  contained: boolean;
  x: number;
  z: number;
}

/** Cell membership, the same rule as the watch's rasterized lists (`regionContainsCell`). */
export const spotInRegion = (region: Pick<MapRegion, "shape">, spot: RegionSpot) =>
  !spot.contained && regionContainsCell(region, spot.x, spot.z);

/** The cell index of a map position (`z * cellsX + x`), `NOWHERE` off the map. */
export const cellIndexAt = (x: number, z: number, cellsX: number, cellsZ: number) => {
  const cellX = Math.floor(x), cellZ = Math.floor(z);
  if (cellX < 0 || cellZ < 0 || cellX >= cellsX || cellZ >= cellsZ) return NOWHERE;
  return cellZ * cellsX + cellX;
};

/**
 * Visits the list ids of cell `from` that are missing from cell `to`, ascending (both CSR slices are sorted; a
 * negative cell has none): the regions or zones a move from `to` to `from` enters.
 */
export const forEachMissingId = (lists: RegionCellLists, from: number, to: number, visit: (id: number) => void) => {
  if (from < 0) return;
  const { ids, start } = lists;
  let other = to < 0 ? 0 : start[to]!;
  const otherEnd = to < 0 ? 0 : start[to + 1]!;
  for (let index = start[from]!; index < start[from + 1]!; index++) {
    const id = ids[index]!;
    while (other < otherEnd && ids[other]! < id) other++;
    if (other < otherEnd && ids[other] === id) continue;
    visit(id);
  }
};

interface CellWatchHost {
  emit: (emission: ScriptEmission) => void;
  generations: ScriptGenerations;
  isSubscribed: (kind: ScriptEventKind) => boolean;
  /** False during offline catch-up: nothing is announced then (the watch re-samples silently afterwards). */
  live: () => boolean;
  /** A watched region's membership changed: its waits re-check this tick. */
  markRegion: (regionId: string) => void;
  /** Animal handles (TRG3b); without them animals are not watched. */
  natureGenerations?: NatureGenerations;
}

type Describe = () => ScriptEventActor | undefined;

/**
 * Last cells of one id space (unit uids or wildlife slots) against one region list in CSR form: a changed cell
 * compares the two cells' region slices and announces the difference (leaves first, then enters, region order).
 */
const createRegionTracker = (regions: readonly MapRegion[], cellsX: number, cellsZ: number, host: CellWatchHost) => {
  const lists = buildRegionCellLists(regions, cellsX, cellsZ);
  const { start } = lists;
  let lastCell = new Int32Array(WATCH_INITIAL_CAPACITY).fill(UNSEEN);

  const ensureCapacity = (id: number) => {
    if (id < lastCell.length) return;
    let size = lastCell.length;
    while (size <= id) size *= 2;
    const grown = new Int32Array(size).fill(UNSEEN);
    grown.set(lastCell);
    lastCell = grown;
  };
  const sliceStart = (cell: number) => cell < 0 ? 0 : start[cell]!;
  const sliceEnd = (cell: number) => cell < 0 ? 0 : start[cell + 1]!;
  const isWatched = (cell: number) => sliceStart(cell) !== sliceEnd(cell);

  const announce = (kind: ScriptEventKind, subject: ScriptEventActor | undefined, regionIndex: number) => {
    const region = regions[regionIndex]!;
    host.markRegion(region.id);
    if (!subject || !host.isSubscribed(kind)) return;
    host.emit({
      actors: { subject }, kind, player: subject.owner,
      responses: { enteringActor: subject.handle, region: { type: "region", value: { id: region.id, k: "ref",
        kind: "region" } } },
      values: { region: region.id }
    });
  };
  /** Regions of cell `from` missing from cell `to`, ascending. */
  const announceMissing = (kind: ScriptEventKind, subject: ScriptEventActor | undefined, from: number, to: number) =>
    forEachMissingId(lists, from, to, region => announce(kind, subject, region));
  return {
    cellAt: (x: number, z: number) => cellIndexAt(x, z, cellsX, cellsZ),
    clear: () => lastCell.fill(UNSEEN),
    /** The id left the world: it leaves its regions, its id starts unseen. */
    forget: (id: number, subject: ScriptEventActor | undefined) => {
      if (id >= lastCell.length) return;
      const before = lastCell[id]!;
      lastCell[id] = UNSEEN;
      if (host.live() && isWatched(before)) announceMissing("leftRegion", subject, before, NOWHERE);
    },
    /** A live sample: a changed cell announces the region difference (the subject is described only then). */
    move: (id: number, cell: number, describe: Describe) => {
      ensureCapacity(id);
      const before = lastCell[id]!;
      if (before === cell) return;
      lastCell[id] = cell;
      const from = before === UNSEEN ? NOWHERE : before;
      if (!isWatched(from) && !isWatched(cell)) return;
      const subject = describe();
      announceMissing("leftRegion", subject, from, cell);
      announceMissing("enteredRegion", subject, cell, from);
    },
    /** A silent sample (map start, load, after catch-up). */
    seed: (id: number, cell: number) => {
      ensureCapacity(id);
      lastCell[id] = cell;
    }
  };
};

/** Simulated animals against the wildlife-pinned regions (TRG3b); undefined when nothing pins wildlife. */
const createAnimalTracker = (
  context: SettlementContext, script: MapScript, host: CellWatchHost
) => {
  const wildlife = context.options.scriptNature?.wildlife, generations = host.natureGenerations;
  const regions = wildlife && generations ? wildlifeRegions(script) : [];
  if (!wildlife || !generations || regions.length === 0) return undefined;
  const { cellsX, cellsZ } = context.options.world;
  const tracker = createRegionTracker(regions, cellsX, cellsZ, host);
  const cellOf = (slots: ScriptWildlifeSlots, slot: number) =>
    slots.isSimulated(slot) ? tracker.cellAt(slots.x(slot), slots.z(slot)) : NOWHERE;
  return {
    forget: tracker.forget,
    reset: () => {
      tracker.clear();
      for (let slot = 0; slot < wildlife.capacity; slot++) tracker.seed(slot, cellOf(wildlife, slot));
    },
    update: () => {
      for (let slot = 0; slot < wildlife.capacity; slot++)
        tracker.move(slot, cellOf(wildlife, slot), () => describeAnimal(wildlife, generations, slot));
    }
  };
};

export const createCellWatch = (context: SettlementContext, script: MapScript, host: CellWatchHost) => {
  const regions = watchedRegions(script);
  if (regions.length === 0) return undefined;
  const { cellsX, cellsZ } = context.options.world;
  const units = createRegionTracker(regions, cellsX, cellsZ, host);
  const animals = createAnimalTracker(context, script, host);
  const cellOf = (actor: SettlementActor) => isContained(actor) ? NOWHERE : units.cellAt(actor.x, actor.z);

  /** Silent sample of every person and animal (map start, load, after catch-up). */
  const reset = () => {
    units.clear();
    for (const actor of context.actors) if (actor.phase !== "retired") units.seed(actor.uid, cellOf(actor));
    animals?.reset();
  };
  /** End of a live tick: every person or animal whose cell changed announces the region difference. */
  const update = () => {
    if (!host.live()) return;
    for (const actor of context.actors) {
      if (actor.phase === "retired") continue;
      units.move(actor.uid, cellOf(actor), () => describeUnit(context, host.generations, actor));
    }
    animals?.update();
  };
  reset();
  return {
    /** A person left the world (died, retired, sailed off): it leaves its regions, its uid starts unseen. */
    forget: units.forget,
    /** A wildlife slot's animal left the world: it leaves its pinned regions. */
    forgetAnimal: (slot: number, subject: ScriptEventActor | undefined) => animals?.forget(slot, subject),
    reset,
    update
  };
};

export type CellWatch = NonNullable<ReturnType<typeof createCellWatch>>;
