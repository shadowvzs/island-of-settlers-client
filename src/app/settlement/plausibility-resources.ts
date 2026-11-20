import { COLONY_ORE_PER_MINE_HOUR, COLONY_ORE_SHIP_MS } from "../../shared/balance/colonies";
import { MARBLE_DEPOSIT_QUANTITY, STONE_SOURCE_REST_SECONDS } from "../../shared/balance/resources";
import { MATERIAL_BUILDING_GROUPS } from "../../shared/settlement/advanced-material-production";
import { colonyOreWare } from "../../shared/settlement/colony-island-rules";
import { readGameSave } from "../../shared/settlement/game-save";
import type { PlausibilityResourceDelta } from "../../shared/settlement/plausibility-bounds";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { colonyResourcePair } from "../../shared/world/colony-resource-tiers";
import { ORE, PROP, PROP_REMOVED, type WorldData } from "../../shared/world/world-data";
import type { SaveSnapshot } from "../save-store/save-api-client";
import type { IslandStoneLedgerState } from "./island-stone-ledger";

/** Tree prop kind -> the log ware its felling makes (ordinary trees all make logs). */
const LOG_WARE_BY_TREE: ReadonlyMap<number, string> = new Map([
  [PROP.broadleafTree, "logs"],
  [PROP.coniferTree, "logs"],
  [PROP.palmTree, "logs"],
  [PROP.birchTree, "logs"],
  ...MATERIAL_BUILDING_GROUPS.map(group => [PROP[group.tree], group.logs] as const)
]);
const LOG_WARES = [...new Set(LOG_WARE_BY_TREE.values())];
/** Ores with a mine ware; granite's stone still has quarry sources, so it is recorded but not capped here. */
const oreWare = (ore: number, world: WorldData) => {
  if (ore === ORE.coal) return "coal";
  if (ore === ORE.iron) return "ironOre";
  if (ore === ORE.gold) return "goldOre";
  if (ore === ORE.granite)
    return world.colonyResourceTier ? colonyResourcePair(world.colonyResourceTier).stone : "stone";
  return undefined;
};

const add = (goods: Record<string, number>, ware: string, count: number) => {
  if (Number.isFinite(count) && count > 0) goods[ware] = (goods[ware] ?? 0) + count;
};

const mineCount = (buildings: readonly SettlementBuilding[] | undefined) =>
  buildings?.filter(building => building.construction === 1 && building.typeId >= 10 && building.typeId <= 13)
    .length ?? 0;

const snapshotIslandData = (snapshot: SaveSnapshot) =>
  new Map(snapshot.islands.map(island => [island.key, island.save.data]));

const decodeIslands = async (rows: ReadonlyMap<string, Record<string, unknown>>) => {
  const decoded = new Map<string, Awaited<ReturnType<typeof readGameSave>>>();
  for (const [key, data] of rows) {
    try {
      decoded.set(key, await readGameSave(data));
    } catch {
      return null;
    }
  }
  return decoded;
};

/** Ore per mine-zone id, one pass over the cell layer. */
const oreByZone = (world: WorldData) => {
  const totals = new Map<number, number>();
  for (let cell = 0; cell < world.oreAmount.length; cell++) {
    const zone = world.mineZone[cell]!;
    if (!zone) continue;
    totals.set(zone, (totals.get(zone) ?? 0) + world.oreAmount[cell]!);
  }
  return totals;
};

/** One felled tree of a species yields one log; the maps keep stable prop ids across a removal (PROP_REMOVED). */
const countFelledTrees = (before: WorldData, after: WorldData, goods: Record<string, number>) => {
  const count = Math.min(before.props.count, after.props.count);
  for (let id = 0; id < count; id++) {
    if (after.props.types[id] !== PROP_REMOVED) continue;
    const ware = LOG_WARE_BY_TREE.get(before.props.types[id]!);
    if (ware) add(goods, ware, 1);
  }
};

/**
 * Surveyed ore decreases by ore type. Only zones present in both maps with the same ore count: a map edit that
 * removes or changes a zone is not attributed, which can only make the bound more permissive.
 */
const countMinedOre = (before: WorldData, after: WorldData, goods: Record<string, number>) => {
  const beforeOre = oreByZone(before), afterOre = oreByZone(after);
  for (const zone of before.mineZones) {
    const later = after.mineZones.find(entry => entry.id === zone.id);
    if (!later || later.ore !== zone.ore || (!zone.surveyed && !later.surveyed)) continue;
    const ware = oreWare(zone.ore, after);
    if (!ware) continue;
    add(goods, ware, (beforeOre.get(zone.id) ?? 0) - (afterOre.get(zone.id) ?? 0));
  }
};

const BOULDER_AMOUNT = 6;
const FORMATION_AMOUNT = 24;
const SEAM_AMOUNT = 12;

const runtimeStone = (runtime: unknown): IslandStoneLedgerState | undefined => {
  const stone = (runtime as { stone?: unknown } | undefined)?.stone;
  if (!stone || typeof stone !== "object") return undefined;
  const value = stone as Partial<IslandStoneLedgerState>;
  if (!Array.isArray(value.formations) || !Array.isArray(value.props) || !Array.isArray(value.seams))
    return undefined;
  return value as IslandStoneLedgerState;
};

const remainingMap = (entries: readonly (readonly number[])[] | undefined, capacity: number) =>
  new Map((entries ?? []).map(entry => [entry[0]!, Number.isFinite(entry.length === 4 ? entry[3]! : entry[1]!)
    ? Math.max(0, Math.min(capacity, entry.length === 4 ? entry[3]! : entry[1]!)) : capacity] as const));

/** Capability represented by one extra full source cycle for a window long enough to respawn it. */
const respawnCycles = (seconds: number) =>
  seconds < STONE_SOURCE_REST_SECONDS ? 0 :
    1 + Math.floor((seconds - STONE_SOURCE_REST_SECONDS) / STONE_SOURCE_REST_SECONDS);

const addSource = (goods: Record<string, number>, ware: string, beforeRemaining: number, afterRemaining: number,
  capacity: number, seconds: number) =>
  add(goods, ware, Math.max(0, beforeRemaining - afterRemaining) + capacity * respawnCycles(seconds));

/** Runtime/material stone sources not represented by a simple production rate. */
const countStoneSources = (before: Awaited<ReturnType<typeof readGameSave>>,
  after: Awaited<ReturnType<typeof readGameSave>>, seconds: number, goods: Record<string, number>) => {
  const early = runtimeStone(before.runtime), late = runtimeStone(after.runtime);
  const boulders = new Set<number>();
  for (const [world, ledger] of [[before.map.world, early], [after.map.world, late]] as const)
    for (let id = 0; id < world.props.count; id++)
      if (world.props.types[id] === PROP.largeRock || ledger?.props.some(([prop]) => prop === id))
        boulders.add(id);
  const earlyProps = remainingMap(early?.props, BOULDER_AMOUNT);
  const lateProps = remainingMap(late?.props, BOULDER_AMOUNT);
  for (const id of boulders) {
    const beforeRemaining = before.map.world.props.types[id] === PROP.largeRock
      ? earlyProps.get(id) ?? BOULDER_AMOUNT : 0;
    const afterRemaining = after.map.world.props.types[id] === PROP.largeRock
      ? lateProps.get(id) ?? BOULDER_AMOUNT : 0;
    addSource(goods, "stone", beforeRemaining, afterRemaining, BOULDER_AMOUNT, seconds);
  }
  const countEntries = (earlyEntries: readonly (readonly number[])[] | undefined,
    lateEntries: readonly (readonly number[])[] | undefined, capacity: number) => {
    const a = remainingMap(earlyEntries, capacity), b = remainingMap(lateEntries, capacity);
    for (const id of new Set([...a.keys(), ...b.keys()]))
      addSource(goods, "stone", a.get(id) ?? capacity, b.get(id) ?? capacity, capacity, seconds);
  };
  countEntries(early?.formations, late?.formations, FORMATION_AMOUNT);
  countEntries(early?.seams, late?.seams, SEAM_AMOUNT);
  const deposits = new Map<number, { before: number; after: number; ware: string }>();
  const collectDeposits = (loaded: Awaited<ReturnType<typeof readGameSave>>, side: "before" | "after") => {
    for (const deposit of loaded.settlement.marbleDeposits ?? []) {
      const entry = deposits.get(deposit.id) ?? { after: MARBLE_DEPOSIT_QUANTITY,
        before: MARBLE_DEPOSIT_QUANTITY, ware: deposit.material ?? "marble" };
      entry[side] = deposit.remaining;
      deposits.set(deposit.id, entry);
    }
  };
  collectDeposits(before, "before");
  collectDeposits(after, "after");
  for (const { after: afterRemaining, before: beforeRemaining, ware } of deposits.values())
    addSource(goods, ware, beforeRemaining, afterRemaining, MARBLE_DEPOSIT_QUANTITY, seconds);
};

type ColonyPair = { after?: Record<string, unknown>; before?: Record<string, unknown> };

const colonyPairs = (before: SaveSnapshot, after: SaveSnapshot) => {
  const colonies = new Map<number, ColonyPair>();
  const collect = (snapshot: SaveSnapshot, side: "after" | "before") => {
    for (const entry of snapshot.colonies) {
      const record = entry.data;
      if (typeof record.expeditionId !== "number" || !Number.isSafeInteger(record.expeditionId)) continue;
      const id = record.expeditionId;
      const row = colonies.get(id) ?? {};
      row[side] = record;
      colonies.set(id, row);
    }
  };
  collect(before, "before");
  collect(after, "after");
  return colonies;
};

const nextOreShip = (record: Record<string, unknown> | undefined) =>
  typeof record?.nextOreShipAt === "number" && Number.isFinite(record.nextOreShipAt)
    ? record.nextOreShipAt : undefined;

/** Hours of abstract ore a colony's ship clock covered: its schedule advance, else the upload time + one ship. */
const oreShipHours = (pair: ColonyPair, seconds: number) => {
  const elapsedHours = Math.max(0, seconds) / 3600 + COLONY_ORE_SHIP_MS / 3_600_000;
  const early = nextOreShip(pair.before), late = nextOreShip(pair.after);
  const scheduledHours = early !== undefined && late !== undefined && late > early
    ? (late - early) / COLONY_ORE_SHIP_MS : 0;
  return Math.max(elapsedHours, scheduledHours);
};

/**
 * Ore shipped home from colonies that were off screen: the abstract hourly shipment creates ore without a
 * local map decrease. Its maximum is the completed mines' hourly rate for the hours the colony's ship clock
 * advanced (plus one interval and the elapsed upload time); stored ore shipped home is already counted in the
 * holdings of both snapshots. If the schedule is unavailable or moves backwards, the elapsed time is the
 * conservative fallback rather than a stricter reading of the clock.
 */
const countColonyShipments = (before: SaveSnapshot, after: SaveSnapshot, seconds: number,
  early: ReadonlyMap<string, Awaited<ReturnType<typeof readGameSave>>>,
  late: ReadonlyMap<string, Awaited<ReturnType<typeof readGameSave>>>, goods: Record<string, number>) => {
  for (const [id, pair] of colonyPairs(before, after)) {
    const record = pair.after ?? pair.before;
    const island = record?.island as { ore?: "coal" | "ironOre" | "goldOre" | "stone"; resourceTier?: 1 | 2 | 3 | 4 } |
      undefined;
    if (!island?.ore) continue;
    const conquered = pair.before?.status === "conquered" || pair.after?.status === "conquered";
    if (!conquered) continue;
    const key = `colony-${id}`;
    const mines = Math.max(mineCount(early.get(key)?.settlement.buildings),
      mineCount(late.get(key)?.settlement.buildings));
    if (!mines) continue;
    add(goods, colonyOreWare({ ore: island.ore, resourceTier: island.resourceTier }),
      Math.ceil(mines * COLONY_ORE_PER_MINE_HOUR * oreShipHours(pair, seconds)));
  }
};

/**
 * Map-derived plausibility delta of a snapshot pair (D4 per-resource bounds). The server bundle runs this before
 * the shared sync check; any undecodable, missing or structurally changed island pair returns null, so the caller
 * skips only the map-specific checks and never rejects the upload because a map was unavailable.
 */
export const decodePlausibilityResources = async (
  before: SaveSnapshot, after: SaveSnapshot, seconds: number
): Promise<PlausibilityResourceDelta | null> => {
  const beforeRows = snapshotIslandData(before), afterRows = snapshotIslandData(after);
  if (!beforeRows.size || beforeRows.size !== afterRows.size) return null;
  for (const key of beforeRows.keys()) if (!afterRows.has(key)) return null;
  const early = await decodeIslands(beforeRows), late = await decodeIslands(afterRows);
  if (!early || !late) return null;
  for (const [key, island] of early) {
    const other = late.get(key)!;
    if (island.map.world.seed !== other.map.world.seed ||
      island.map.world.cellsX !== other.map.world.cellsX ||
      island.map.world.cellsZ !== other.map.world.cellsZ) return null;
  }
  const felledTrees: Record<string, number> = Object.fromEntries(LOG_WARES.map(ware => [ware, 0]));
  const minedOre: Record<string, number> = { coal: 0, ironOre: 0, goldOre: 0 };
  const stoneSources: Record<string, number> = {};
  const colonyShipments: Record<string, number> = {};
  for (const [key, island] of early) {
    const other = late.get(key)!;
    countFelledTrees(island.map.world, other.map.world, felledTrees);
    countMinedOre(island.map.world, other.map.world, minedOre);
    countStoneSources(island, other, seconds, stoneSources);
  }
  countColonyShipments(before, after, seconds, early, late, colonyShipments);
  return { colonyShipments, felledTrees, minedOre,
    stoneSources: Object.keys(stoneSources).length ? stoneSources : undefined };
};
