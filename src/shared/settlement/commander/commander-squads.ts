import { MORALE_BROKEN, MORALE_BROKEN_STRENGTH } from "../../balance/morale";
import { deterministicPow } from "../../math/deterministic-math";
import type { MilitaryTroopType } from "../military-combat-rules";
import { distanceBetween } from "../settlement-geometry";
import type { SettlementPoint } from "../settlement-types";
import type { CommanderUnit } from "./commander-types";

/** Soldiers this close (tiles) to a squad member belong to its squad. */
const SQUAD_LINK = 6;
/** Worth of each troop type in soldier-equivalents. */
export const TYPE_VALUE: Readonly<Record<MilitaryTroopType, number>> = {
  archer: 0.9,
  cavalry: 1.5,
  heavy: 1.2,
  shield: 1
};

/** Every rank is worth this much more than the one below it. */
const RANK_STEP = 1.2;
/** Ranks below this keep their worth in a table (the deterministic power allocates on every call). */
const CACHED_RANKS = 32;
/** A list this short is sorted in place by insertion (the native sort allocates on every call). */
const INSERTION_SORT_LIMIT = 48;

const byUid = (first: CommanderUnit, second: CommanderUnit) => first.uid - second.uid;
const ascending = (first: number, second: number) => first - second;
const linkCell = (coordinate: number) => Math.floor(coordinate / SQUAD_LINK);

const rankValues: number[] = [];
/** Worth of a rank (1.2 per rank). */
export const rankValueOf = (rank: number) => {
  if (!Number.isInteger(rank) || rank < 0 || rank >= CACHED_RANKS) return deterministicPow(RANK_STEP, rank);
  return (rankValues[rank] ??= deterministicPow(RANK_STEP, rank));
};

/**
 * Fighting strength of a soldier in soldier-equivalents (health, troop type and rank); a broken soldier (A14-2
 * morale) counts with `MORALE_BROKEN_STRENGTH` of it.
 */
export const strengthOf = (unit: Pick<CommanderUnit, "health" | "moraleState" | "rank" | "type">) =>
  strengthFrom(unit.health, unit.type, unit.rank, unit.moraleState);

/** `strengthOf` from its parts (no object: the morale sweep calls it per neighbour). */
export const strengthFrom = (health: number, type: MilitaryTroopType, rank: number, moraleState?: number) => {
  const strength = health * TYPE_VALUE[type] * rankValueOf(rank);
  return moraleState === MORALE_BROKEN ? strength * MORALE_BROKEN_STRENGTH : strength;
};

const isInUidOrder = (units: readonly CommanderUnit[]) => {
  for (let index = 1; index < units.length; index++) if (units[index - 1]!.uid > units[index]!.uid) return false;
  return true;
};

/** Sorts distinct indices ascending in place. */
const sortAscending = (values: number[]) => {
  if (values.length > INSERTION_SORT_LIMIT) {
    values.sort(ascending);
    return;
  }
  for (let index = 1; index < values.length; index++) {
    const value = values[index]!;
    let slot = index;
    for (; slot > 0 && values[slot - 1]! > value; slot--) values[slot] = values[slot - 1]!;
    values[slot] = value;
  }
};

/** The mean position of the units (a new point; the units are summed in their order). */
export const centreOf = (units: readonly SettlementPoint[]): SettlementPoint => {
  let x = 0,
    z = 0;
  for (const unit of units) {
    x += unit.x;
    z += unit.z;
  }
  return { x: x / units.length, z: z / units.length };
};

/** The mean camp or post of the squad's members (a new point). */
export const homeOf = (squad: readonly CommanderUnit[]): SettlementPoint => {
  let x = 0,
    z = 0;
  for (const unit of squad) {
    x += unit.home.x;
    z += unit.home.z;
  }
  return { x: x / squad.length, z: z / squad.length };
};

/**
 * Groups one side's soldiers into squads: chains of comrades within `SQUAD_LINK`, in uid order. The
 * soldiers are counting-sorted into link-sized cells (numeric indices over their bounding box), so a
 * member only checks the nine cells round it. Every array is reused between calls and only grows: the
 * returned squads are valid until the next call.
 */
export const createSquadFormer = () => {
  const sorted: CommanderUnit[] = [],
    nearby: number[] = [],
    pool: CommanderUnit[][] = [],
    squads: CommanderUnit[][] = [];
  /** `starts[cell]` .. `starts[cell + 1]` index `cellOrder`: the uid-ordered soldiers of the cell. */
  let starts = new Uint32Array(64),
    cursor = new Uint32Array(64),
    cellOf = new Uint32Array(64),
    cellOrder = new Uint32Array(64),
    taken = new Uint8Array(64);
  let minX = 0,
    minZ = 0,
    columns = 1,
    rows = 1;

  const reserve = (count: number, cells: number) => {
    if (starts.length < cells + 1) {
      starts = new Uint32Array(Math.max(cells + 1, starts.length * 2));
      cursor = new Uint32Array(starts.length);
    }
    if (cellOf.length >= count) return;
    const size = Math.max(count, cellOf.length * 2);
    cellOf = new Uint32Array(size);
    cellOrder = new Uint32Array(size);
    taken = new Uint8Array(size);
  };
  const measure = () => {
    let maxX = -Infinity,
      maxZ = -Infinity;
    minX = Infinity;
    minZ = Infinity;
    for (const unit of sorted) {
      const x = linkCell(unit.x),
        z = linkCell(unit.z);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    columns = maxX - minX + 1;
    rows = maxZ - minZ + 1;
  };
  /** Counting sort of the uid-ordered soldiers into their cells (stable: uid order inside a cell). */
  const sortIntoCells = () => {
    const count = sorted.length,
      cells = columns * rows;
    reserve(count, cells);
    starts.fill(0, 0, cells + 1);
    taken.fill(0, 0, count);
    for (let index = 0; index < count; index++) {
      const unit = sorted[index]!;
      const cell = (linkCell(unit.z) - minZ) * columns + (linkCell(unit.x) - minX);
      cellOf[index] = cell;
      starts[cell + 1]!++;
    }
    for (let cell = 0; cell < cells; cell++) starts[cell + 1]! += starts[cell]!;
    cursor.set(starts.subarray(0, cells));
    for (let index = 0; index < count; index++) cellOrder[cursor[cellOf[index]!]!++] = index;
  };
  /** Free soldiers within the link distance of `centre`, as ascending `sorted` indices (uid order). */
  const collectNearby = (centre: CommanderUnit) => {
    nearby.length = 0;
    const x = linkCell(centre.x) - minX,
      z = linkCell(centre.z) - minZ;
    for (let row = Math.max(0, z - 1); row <= Math.min(rows - 1, z + 1); row++)
      for (let column = Math.max(0, x - 1); column <= Math.min(columns - 1, x + 1); column++) {
        const cell = row * columns + column;
        for (let slot = starts[cell]!; slot < starts[cell + 1]!; slot++) {
          const index = cellOrder[slot]!;
          if (!taken[index] && distanceBetween(sorted[index]!, centre) <= SQUAD_LINK) nearby.push(index);
        }
      }
    sortAscending(nearby);
  };
  const openSquad = () => {
    const squad = pool[squads.length] ?? (pool[squads.length] = []);
    squad.length = 0;
    squads.push(squad);
    return squad;
  };

  return (units: readonly CommanderUnit[]): readonly (readonly CommanderUnit[])[] => {
    sorted.length = 0;
    squads.length = 0;
    for (const unit of units) sorted.push(unit);
    if (!sorted.length) return squads;
    if (!isInUidOrder(sorted)) sorted.sort(byUid);
    measure();
    sortIntoCells();
    for (let first = 0; first < sorted.length; first++) {
      if (taken[first]) continue;
      const squad = openSquad();
      taken[first] = 1;
      squad.push(sorted[first]!);
      for (let member = 0; member < squad.length; member++) {
        collectNearby(squad[member]!);
        for (const index of nearby) {
          taken[index] = 1;
          squad.push(sorted[index]!);
        }
      }
    }
    return squads;
  };
};

/** Squads of one side as new arrays (tests and one-off callers; the commander reuses a former). */
export const formSquads = (units: readonly CommanderUnit[]) =>
  createSquadFormer()(units).map((squad) => [...squad]);
