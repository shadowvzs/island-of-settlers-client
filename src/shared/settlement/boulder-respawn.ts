import { STONE_SOURCE_REST_SECONDS } from "../balance/resources";
import { DMath } from "../math/deterministic-math";
import { restoreRemovedProp } from "../world/editing/prop-placement";
import { bumpBuildRevision, markWorldCellChanged } from "../world/save/world-change-journal";
import { BLOCKING, PROP, PROP_REMOVED, type WorldData } from "../world/world-data";
import { distanceToSegmentXZ } from "./settlement-geometry";
import { roadClearanceRadius } from "./settlement-ground-clearance";
import { bumpNavigationRevision } from "./settlement-reservations";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Every stone source shares one life: worked out it disappears, rests STONE_SOURCE_REST_SECONDS of game
 * time, then grows back at the same spot with a fresh amount, waiting while that spot is taken. A plain
 * quarry boulder is a world prop; a marble, limestone, basalt or granite deposit is a deposit id.
 */
export type StoneSourceKind = "deposit" | "prop" | "island";

/** A worked out stone source resting until it respawns. */
export interface StoneRespawn {
  id: number;
  kind: StoneSourceKind;
  /** Game seconds rested; due at STONE_SOURCE_REST_SECONDS, later while its spot is taken. */
  restSeconds: number;
}

/** How the owner of one source kind finds a resting source's spot and brings it back. */
export interface RespawningStoneSources {
  /** Where the resting source returns; null when it is gone for good (dropped from the list). */
  spot: (context: SettlementContext, id: number) => SettlementPoint | null;
  /** Brings it back with a fresh amount (the spot is free). */
  restore: (context: SettlementContext, id: number) => void;
}

/** Read-only placement view shared by native timers and detached offline source budgets. */
export interface StoneRespawnPlacementContext {
  options: Pick<SettlementContext["options"], "world" | "roads" | "stoneSources">;
  occupied: ArrayLike<number>;
  reservations: Pick<ReadonlySet<string>, "has">;
  fieldCycles?: Pick<NonNullable<SettlementContext["fieldCycles"]>, "isOccupied">;
  buildings: readonly Pick<SettlementContext["buildings"][number], "x" | "z" | "width" | "depth">[];
  actors: readonly Pick<SettlementContext["actors"][number], "visible" | "x" | "z">[];
}

/** Clearance a returning stone keeps from buildings and walking people (its body and companions). */
const SPOT_MARGIN = .9;
/** Cells of the stone's body a road or plot once cleared; freed again when it respawns. */
const BODY_HALF_SIZE = .6;

const ledgers = new WeakMap<SettlementContext, StoneRespawn[]>();
const ledgerOf = (context: SettlementContext) => {
  let ledger = ledgers.get(context);
  if (!ledger) {
    ledger = [];
    ledgers.set(context, ledger);
  }
  return ledger;
};
/** A stone source was worked out (gone from the map): it rests, then comes back at the same spot. */
export const queueStoneRespawn = (context: SettlementContext, kind: StoneSourceKind, id: number) => {
  const ledger = ledgerOf(context);
  if (ledger.some(entry => entry.kind === kind && entry.id === id)) return;
  ledger.push({ id, kind, restSeconds: 0 });
};

/** Legacy exhausted island ledgers begin resting now; an existing timer always retains its age. */
const syncedIslandSources = new WeakMap<SettlementContext, readonly number[]>();
const syncIslandSources = (context: SettlementContext) => {
  const exhausted = context.options.stoneSources?.exhausted();
  if (!exhausted || syncedIslandSources.get(context) === exhausted) return;
  syncedIslandSources.set(context, exhausted);
  for (const id of exhausted) queueStoneRespawn(context, id >= 0 ? "prop" : "island", id);
};

const coveredByBuilding = (context: StoneRespawnPlacementContext, x: number, z: number) =>
  context.buildings.some(building => Math.abs(building.x - x) < building.width / 2 + SPOT_MARGIN &&
    Math.abs(building.z - z) < building.depth / 2 + SPOT_MARGIN);

const coveredByRoad = (context: StoneRespawnPlacementContext, x: number, z: number) =>
  context.options.roads.segments?.().some(road =>
    distanceToSegmentXZ(x, z, road.start.x, road.start.z, road.end.x, road.end.z) <= roadClearanceRadius(road));

const cellTaken = (context: StoneRespawnPlacementContext, world: WorldData, cell: number) =>
  Boolean(context.occupied[cell]) || world.blocking[cell] !== BLOCKING.free ||
  context.reservations.has(`field:${cell}`) || context.reservations.has(`plant:${cell}`);

/** Nothing built, planned, planted, paved or standing where the stone returns. */
const isSpotFree = (context: StoneRespawnPlacementContext, x: number, z: number, island = false) => {
  const { world } = context.options;
  const cell = Math.floor(z) * world.cellsX + Math.floor(x);
  if ((island ? Boolean(context.occupied[cell]) || world.blocking[cell] === BLOCKING.prop ||
      world.blocking[cell] === BLOCKING.water || context.reservations.has(`field:${cell}`) ||
      context.reservations.has(`plant:${cell}`) : cellTaken(context, world, cell)) || context.fieldCycles?.isOccupied(x, z)) return false;
  if (coveredByBuilding(context, x, z) || coveredByRoad(context, x, z)) return false;
  return !context.actors.some(actor => actor.visible && DMath.hypot(actor.x - x, actor.z - z) < SPOT_MARGIN);
};

/** The native respawn decision without restoring the source or changing clearance/navigation. */
export const canRespawnStoneAt = (context: StoneRespawnPlacementContext, kind: StoneSourceKind,
  id: number, spot: SettlementPoint) => isSpotFree(context, spot.x, spot.z, kind === "island") &&
    (kind !== "island" || Boolean(context.options.stoneSources?.canRestore(id)));

/** A road or plot that has gone left its cleared ground mark; the returning stone owns it again. */
const releaseClearedGround = (world: WorldData, x: number, z: number) => {
  for (let cz = Math.floor(z - BODY_HALF_SIZE); cz <= Math.floor(z + BODY_HALF_SIZE); cz++)
    for (let cx = Math.floor(x - BODY_HALF_SIZE); cx <= Math.floor(x + BODY_HALF_SIZE); cx++) {
      if (cx < 0 || cz < 0 || cx >= world.cellsX || cz >= world.cellsZ) continue;
      const cell = cz * world.cellsX + cx;
      if (world.settlementGroundClearance) world.settlementGroundClearance[cell] = 0;
      if (world.clearedStoneGround) world.clearedStoneGround[cell] = 0;
      markWorldCellChanged(world, cell);
    }
};

/** Plain quarry boulders: the removed prop itself comes back (same place, size, facing and look). */
const BOULDER_SOURCES: RespawningStoneSources = {
  restore: (context, prop) => {
    if (!restoreRemovedProp(context.options.world, prop, PROP.largeRock)) return;
    context.options.onBoulderRespawned?.(prop);
  },
  spot: ({ options: { world } }, prop) => world.props.types[prop] === PROP_REMOVED
    ? { x: world.props.x[prop]!, z: world.props.z[prop]! } : null
};

/** Brings the source back; false when its spot is still taken (it keeps waiting). */
const respawnStone = (context: SettlementContext, sources: RespawningStoneSources, entry: StoneRespawn,
  spot: SettlementPoint) => {
  const { world } = context.options;
  if (!canRespawnStoneAt(context, entry.kind, entry.id, spot)) return false;
  if (entry.kind !== "island") releaseClearedGround(world, spot.x, spot.z);
  sources.restore(context, entry.id);
  bumpBuildRevision(world, null);
  bumpNavigationRevision(context);
  return true;
};

/** One scheduler tick of a resting source: game seconds, clamped at the due point. */
export const advanceStoneRestSeconds = (restSeconds: number, dt: number) =>
  Math.min(STONE_SOURCE_REST_SECONDS, restSeconds + Math.max(0, dt));

/** Scheduler fires (`dt` each) until the source is due, for the event-core timer plan. */
export const stoneRestSchedulerFires = (restSeconds: number, dt = .5) => {
  let rest = restSeconds, fires = 0;
  while (rest < STONE_SOURCE_REST_SECONDS && fires < 100_000) { rest = advanceStoneRestSeconds(rest, dt); fires++; }
  return { fires, rest };
};

/**
 * Resting stones count game time (a short timer list, ticked every half second); a due one respawns
 * when its spot is free. A source that went for good meanwhile (an editor change) is dropped.
 */
export const updateStoneRespawns = (context: SettlementContext, dt: number, deposits: RespawningStoneSources) => {
  syncIslandSources(context);
  const ledger = ledgers.get(context);
  if (!ledger?.length) return;
  for (let index = ledger.length - 1; index >= 0; index--) {
    const entry = ledger[index]!;
    const sources: RespawningStoneSources = entry.kind === "prop" ? BOULDER_SOURCES : entry.kind === "island" ? {
      spot: (_context, id) => context.options.stoneSources?.spot(id) ?? null,
      restore: (_context, id) => context.options.stoneSources?.refill(id)
    } : deposits;
    const spot = sources.spot(context, entry.id);
    if (!spot) {
      ledger.splice(index, 1);
      continue;
    }
    entry.restSeconds = advanceStoneRestSeconds(entry.restSeconds, dt);
    if (entry.restSeconds < STONE_SOURCE_REST_SECONDS) continue;
    if (respawnStone(context, sources, entry, spot)) ledger.splice(index, 1);
  }
};

export const saveStoneRespawns = (context: SettlementContext): StoneRespawn[] => {
  syncIslandSources(context);
  return (ledgers.get(context) ?? []).map(entry => ({ ...entry }));
};

/** Boulders waiting to grow back (timers of the counter checksum). */
export const pendingStoneRespawns = (context: SettlementContext) => {
  syncIslandSources(context);
  return ledgers.get(context)?.length ?? 0;
};

export const restoreStoneRespawns = (context: SettlementContext, saved: readonly StoneRespawn[] = []) => {
  ledgers.set(context, saved.map(entry => ({ ...entry })));
  syncedIslandSources.delete(context);
  syncIslandSources(context);
};

const validSourceId = (kind: unknown, id: unknown, world: WorldData, maxDeposits: number) => {
  if (!Number.isSafeInteger(id)) return false;
  if (kind === "island") return (id as number) < 0;
  if ((id as number) < 0) return false;
  if (kind === "prop") return (id as number) < world.props.count;
  return kind === "deposit" && (id as number) < maxDeposits;
};

/** Saved stone timers: existing props or deposit ids, each once, with a finite rest. */
export const validStoneRespawns = (value: unknown, world: WorldData, maxDeposits: number) => {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>();
  return value.every(entry => {
    if (!entry || typeof entry !== "object") return false;
    const { id, kind, restSeconds } = entry as Partial<StoneRespawn>;
    if (!validSourceId(kind, id, world, maxDeposits) || keys.has(`${kind}:${id}`)) return false;
    keys.add(`${kind}:${id}`);
    return typeof restSeconds === "number" && Number.isFinite(restSeconds) && restSeconds >= 0;
  });
};
