import { WALL_REPAIR_SECONDS } from "../balance/military";
import { ownerThreatenedAt } from "./military-civilian-safety";
import { getBuilding } from "./settlement-building-index";
import {
  OUTING_OUTBOUND_PHASE, returnFromOuting, returnsFromOuting, startOuting, walkHomeFromOuting, walkOutbound
} from "./settlement-outing";
import { civilianOwnerOf, ownerOf } from "./settlement-ownership";
import type {
  Goods, SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint
} from "./settlement-types";

/**
 * EAI2d wall repair, the repairer's side: an outing (`settlement-outing.ts`) of a computer economy's settler with
 * the paid wares (`demolitionCargo`) to the building's road access, `WALL_REPAIR_SECONDS` of work, then the walls
 * gain the HP the load paid for and the settler walks home empty. The job is saved on the actor (`wallRepair`).
 * A known enemy near the walls, or walls that fell or changed hands, send it home with its load (the wares
 * return to the stock). Only the economy AI's `maintain` decision sends repairers; the player never auto-repairs.
 */
export interface WallRepairJob {
  /** The building whose walls are mended. */
  building: number;
  /** The wall HP the carried load pays for. */
  hp: number;
}

const WALL_REPAIR_PHASE = "wallRepair";

/** Whether the person is on a repair outing (walking there, working, or walking home): the faction's one repairer. */
export const repairsWalls = (actor: SettlementActor) => actor.wallRepair !== undefined &&
  !actor.demolitionReturning && (actor.phase === OUTING_OUTBOUND_PHASE || actor.phase === WALL_REPAIR_PHASE ||
    returnsFromOuting(actor));

/** Sends a settler of `storage` with the paid load out to the walls along `path` (from the storage's access). */
export const startWallRepairer = (actor: SettlementActor, storage: SettlementBuilding, job: WallRepairJob,
  load: Readonly<Goods>, path: readonly SettlementPoint[]) => {
  actor.wallRepair = { building: job.building, hp: job.hp };
  actor.demolitionCargo = { ...load };
  startOuting(actor, storage, path);
};

/** The building, while it still stands as the repairer's faction's own with standing walls. */
const repairTarget = (context: SettlementContext, actor: SettlementActor, job: WallRepairJob) => {
  const building = getBuilding(context, job.building), faction = civilianOwnerOf(actor);
  if (!building || ownerOf(building) !== faction) return undefined;
  const walls = context.military?.factionWalls?.(building.uid, faction);
  return walls && walls.hp > 0 ? building : undefined;
};

const work = (context: SettlementContext, actor: SettlementActor, job: WallRepairJob, building: SettlementBuilding,
  dt: number) => {
  if (ownerThreatenedAt(context, civilianOwnerOf(actor), building.access)) {
    walkHomeFromOuting(context, actor);
    return;
  }
  actor.timer += dt;
  if (actor.timer < WALL_REPAIR_SECONDS) return;
  context.military?.repairWalls?.(building.uid, job.hp);
  actor.demolitionCargo = undefined;
  walkHomeFromOuting(context, actor);
};

/** Advances a wall repairer; true when this updater owns the person this tick. */
export const updateWallRepairer = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  const job = actor.wallRepair;
  if (!job) return false;
  if (!repairsWalls(actor)) {
    actor.wallRepair = undefined;
    return false;
  }
  if (returnsFromOuting(actor)) {
    returnFromOuting(context, actor, dt);
    return true;
  }
  const building = repairTarget(context, actor, job);
  if (!building) walkHomeFromOuting(context, actor);
  else if (actor.phase === WALL_REPAIR_PHASE) work(context, actor, job, building, dt);
  else if (walkOutbound(context, actor, dt, WALL_REPAIR_PHASE, building)) walkHomeFromOuting(context, actor);
  return true;
};
