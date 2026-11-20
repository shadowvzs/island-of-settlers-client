import { MARBLE_DEPOSIT_QUANTITY } from "../balance/resources";
import { DMath } from "../math/deterministic-math";
import type { ColonyStone } from "../world/colony-resource-tiers";
import { restoreRemovedProp } from "../world/editing/prop-placement";
import { removePropsAt } from "../world/editing/prop-removal";
import type { MarbleDeposit } from "../world/marble-deposit";
import { PROP } from "../world/world-data";
import { queueStoneRespawn, type RespawningStoneSources } from "./boulder-respawn";
import { reachableCells } from "./settlement-colony";
import { distanceToSegment } from "./settlement-geometry";
import { bumpNavigationRevision } from "./settlement-reservations";
import type { ResourceTarget, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

export { type MarbleDeposit,validMarbleDeposits } from "../world/marble-deposit";

const ledgers = new WeakMap<SettlementContext, MarbleDeposit[]>();
const emptySurveyRevision = new WeakMap<SettlementContext, number>();
const SOURCE_BASE = -3_000_000;
const INITIAL_QUANTITY = MARBLE_DEPOSIT_QUANTITY;
const authoredDefinitions = new WeakMap<SettlementContext, readonly MarbleDeposit[]>();
const sourceCell = (context: SettlementContext, point: SettlementPoint) =>
  Math.floor(point.z) * context.options.world.cellsX + Math.floor(point.x);
/** False once road/building clearance took a live source's boulder (a resting source has none). */
const sourceStillPresent = (context: SettlementContext, deposit: MarbleDeposit) =>
  deposit.sourceProp === undefined || deposit.remaining <= 0 ||
  context.options.world.props.types[deposit.sourceProp] === PROP.largeRock;
const coveredByBuilding = (context: SettlementContext, deposit: MarbleDeposit) =>
  context.buildings.some(building => Math.abs(building.x - deposit.x) < building.width / 2 &&
    Math.abs(building.z - deposit.z) < building.depth / 2);
/**
 * A live source blocks its cell; a worked out one is gone from the map and rests (the shared stone
 * respawn), so a save or map without its timer still gets it back.
 */
const reserveDeposits = (context: SettlementContext, deposits: readonly MarbleDeposit[]) => {
  for (const deposit of deposits) {
    if (deposit.remaining <= 0) queueStoneRespawn(context, "deposit", deposit.id);
    else if (sourceStillPresent(context, deposit)) context.occupied[sourceCell(context, deposit)] = 1;
  }
  if (deposits.length) bumpNavigationRevision(context);
};
const SOURCE_RADIUS = .9;

const nearRoad = (context: SettlementContext, point: SettlementPoint) =>
  context.options.roads.segments?.().some(segment => distanceToSegment(point, segment.start, segment.end) < 2);

const clearSite = (context: SettlementContext, point: SettlementPoint) => {
  const { world } = context.options;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const x = Math.floor(point.x) + dx, z = Math.floor(point.z) + dz, cell = z * world.cellsX + x;
    if (x < 1 || z < 1 || x >= world.cellsX - 1 || z >= world.cellsZ - 1 ||
      !world.walkCost[cell] || context.occupied[cell] || world.buildClass[cell]! < 2 ||
      world.buildClass[cell]! > 4 || context.fieldCycles?.isOccupied(x + .5, z + .5) ||
      context.reservations.has(`plant:${cell}`) || context.reservations.has(`field:${cell}`)) return false;
  }
  if (nearRoad(context, point) || context.actors.some(actor => actor.visible &&
    DMath.hypot(actor.x - point.x, actor.z - point.z) < 2)) return false;
  for (let id = 0; id < world.props.count; id++)
    if (world.props.types[id]! < 255 && DMath.hypot(world.props.x[id]! - point.x,
      world.props.z[id]! - point.z) < 1.5) return false;
  return true;
};

/** A legacy colony gets sources only in unoccupied reachable land; it is surveyed once, never re-placed. */
const resolveMarbleDeposits = (context: SettlementContext): readonly MarbleDeposit[] => {
  const authored = context.options.world.scenario?.marbleDeposits ?? context.options.world.colonyStoneDeposits;
  if ((authored !== undefined || authoredDefinitions.has(context)) &&
    authoredDefinitions.get(context) !== authored) {
    const previousDeposits = ledgers.get(context) ?? [];
    const previousDefinitions = authoredDefinitions.get(context);
    for (const previous of previousDeposits) {
      const retained = authored?.some(deposit => deposit.id === previous.id &&
        deposit.x === previous.x && deposit.z === previous.z);
      if (!retained) context.reservations.delete(`stone:${SOURCE_BASE - previous.id}`);
      if (!coveredByBuilding(context, previous)) context.occupied[sourceCell(context, previous)] = 0;
    }
    ledgers.delete(context); authoredDefinitions.delete(context);
    bumpNavigationRevision(context);
    if (authored !== undefined) {
      const deposits = authored.map(deposit => {
        const definition = previousDefinitions?.find(previous => previous.id === deposit.id);
        const previous = previousDeposits.find(previous => previous.id === deposit.id);
        // An authored move retains identity/depletion; only an explicit changed amount resets quantity.
        const unchanged = definition && previous && definition.remaining === deposit.remaining;
        return { ...deposit, remaining: unchanged ? previous.remaining : deposit.remaining };
      });
      ledgers.set(context, deposits); authoredDefinitions.set(context, authored);
      reserveDeposits(context, deposits);
      return deposits;
    }
  }
  const existing = ledgers.get(context);
  if (authored !== undefined) return existing ?? [];
  if (existing?.length || (existing && emptySurveyRevision.get(context) ===
    (context.options.world.buildRevision ?? 0))) return existing;
  if (!context.colony?.save()) return [];
  const home = context.buildings.find(building => building.colonyHome);
  if (!home) return [];
  const reachable = reachableCells(context, home.access), { world } = context.options;
  const candidates: Array<SettlementPoint & { distance: number }> = [];
  for (let z = 3; z < world.cellsZ - 3; z += 2) for (let x = 3; x < world.cellsX - 3; x += 2) {
    const point = { x: x + .5, z: z + .5 };
    const distance = DMath.hypot(point.x - home.access.x, point.z - home.access.z);
    if (distance >= 9 && distance <= 45 && reachable(point) && clearSite(context, point))
      candidates.push({ ...point, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
  const deposits: MarbleDeposit[] = [];
  for (const point of candidates) {
    if (deposits.some(deposit => DMath.hypot(deposit.x - point.x, deposit.z - point.z) < 10)) continue;
    deposits.push({ id: deposits.length, x: point.x, z: point.z, remaining: INITIAL_QUANTITY });
    if (deposits.length === 3) break;
  }
  ledgers.set(context, deposits);
  if (!deposits.length) emptySurveyRevision.set(context, world.buildRevision ?? 0);
  reserveDeposits(context, deposits);
  return deposits;
};

/** A worked out source leaves the map (its cell and boulder go) and rests until it grows back. */
const exhaustDeposit = (context: SettlementContext, deposit: MarbleDeposit) => {
  deposit.remaining = 0;
  if (!coveredByBuilding(context, deposit)) context.occupied[sourceCell(context, deposit)] = 0;
  const { world } = context.options;
  if (deposit.sourceProp !== undefined && world.props.types[deposit.sourceProp] === PROP.largeRock)
    removePropsAt(world, [deposit.sourceProp]);
  bumpNavigationRevision(context);
  queueStoneRespawn(context, "deposit", deposit.id);
};

/** Road/building clearance may take a live source's boulder: it counts as worked out and rests. */
export const marbleDeposits = (context: SettlementContext): readonly MarbleDeposit[] => {
  const deposits = resolveMarbleDeposits(context);
  for (const deposit of deposits) if (!sourceStillPresent(context, deposit)) exhaustDeposit(context, deposit);
  return deposits;
};

const restingDeposit = (context: SettlementContext, id: number) => {
  const deposit = ledgers.get(context)?.find(source => source.id === id);
  return deposit && deposit.remaining <= 0 ? deposit : undefined;
};

/** Material deposits in the shared stone respawn: back at the same spot with a fresh amount. */
export const RESPAWNING_DEPOSITS: RespawningStoneSources = {
  restore: (context, id) => {
    const deposit = restingDeposit(context, id)!;
    deposit.remaining = INITIAL_QUANTITY;
    if (deposit.sourceProp !== undefined) restoreRemovedProp(context.options.world, deposit.sourceProp, PROP.largeRock);
    context.occupied[sourceCell(context, deposit)] = 1;
  },
  spot: (context, id) => {
    const deposit = restingDeposit(context, id);
    return deposit ? { x: deposit.x, z: deposit.z } : null;
  }
};
export const marbleTargets = (context: SettlementContext, material: ColonyStone = "marble"): ResourceTarget[] =>
  marbleDeposits(context).filter(deposit => deposit.remaining > 0 && (deposit.material ?? "marble") === material)
    .map(deposit => ({ id: SOURCE_BASE - deposit.id, kind: "stone", x: deposit.x, z: deposit.z }));

/** Any deposit of the stone on the island, resting ones included (they respawn). */
export const hasStoneDeposit = (context: SettlementContext, material: ColonyStone) =>
  marbleDeposits(context).some(deposit => (deposit.material ?? "marble") === material);

export const hasMarbleTarget = (context: SettlementContext, target: ResourceTarget) =>
  marbleDeposits(context).some(source => SOURCE_BASE - source.id === target.id && source.remaining > 0 &&
    DMath.hypot(target.x - source.x, target.z - source.z) <= .01);

export const consumeMarble = (context: SettlementContext, target: ResourceTarget, material: ColonyStone = "marble") => {
  const deposit = marbleDeposits(context).find(source => SOURCE_BASE - source.id === target.id);
  if (!deposit || deposit.remaining <= 0 || (deposit.material ?? "marble") !== material ||
    DMath.hypot(target.x - deposit.x, target.z - deposit.z) > .01)
    return false;
  deposit.remaining--;
  if (deposit.remaining === 0) exhaustDeposit(context, deposit);
  return true;
};

export const marblePlotBlocked = (context: SettlementContext, building: SettlementBuilding) =>
  marbleDeposits(context).some(deposit => deposit.remaining > 0 &&
    Math.abs(deposit.x - building.x) < building.width / 2 + SOURCE_RADIUS &&
    Math.abs(deposit.z - building.z) < building.depth / 2 + SOURCE_RADIUS);

export const saveMarbleDeposits = (context: SettlementContext) =>
  marbleDeposits(context).map(deposit => ({ ...deposit }));
export const restoreMarbleDeposits = (context: SettlementContext, saved?: MarbleDeposit[]) => {
  ledgers.delete(context); emptySurveyRevision.delete(context);
  const authored = context.options.world.scenario?.marbleDeposits ?? context.options.world.colonyStoneDeposits;
  if (authored && saved !== undefined) authoredDefinitions.set(context, authored);
  else authoredDefinitions.delete(context);
  if (saved !== undefined) {
    const deposits = saved.map(deposit => ({ ...deposit }));
    ledgers.set(context, deposits); reserveDeposits(context, deposits);
  }
};
