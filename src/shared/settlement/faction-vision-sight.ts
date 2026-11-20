import { GARRISON_CAPACITIES } from "../balance/military";
import {
  CIVILIAN_SIGHT, commanderSight, EXPLORER_SHIP_SIGHT, GARRISON_BUILDING_SIGHT, HEADQUARTERS_SIGHT, SCOUT_SIGHT,
  SOLDIER_SIGHT
} from "../balance/vision";
import { isHomeBuilding } from "./settlement-home";
import type { SettlementSoldier } from "./settlement-military";
import type { NavalShip } from "./settlement-naval-fleet";
import { civilianOwnerOf, ownerOf } from "./settlement-ownership";
import type { SettlementActor, SettlementBuilding } from "./settlement-types";

/** Who sees, and how far: written into a reused record so the per-tick pass allocates nothing. */
export interface VisionSight {
  faction: number;
  radius: number;
}

/** What the sight rules read from the island; the settlement context satisfies it. */
export interface VisionSightSources {
  military?: { soldierOf?: (uid: number) => SettlementSoldier | undefined };
  playerNation?: string;
}

/** The voyage phases in which an exploration ship is at sea on this island's map. */
const EXPLORER_SIGHT_PHASES: ReadonlySet<string> = new Set(["positioning", "sailing", "unloading", "stranded"]);

/** A soldier's sight: the commander's own, else its troop type's (catalog profile). */
const soldierSight = (sources: VisionSightSources, soldier: SettlementSoldier) => {
  if (soldier.commanderId !== undefined) return commanderSight(sources.playerNation ?? "roman");
  return SOLDIER_SIGHT[soldier.combat?.type ?? "shield"];
};

/**
 * The sight of an actor standing in the world, or false: hidden people (inside, aboard, dead) and
 * horses see nothing. Only canonical simulation state is read (no camera, frame or preset).
 */
export const actorSight = (sources: VisionSightSources, actor: SettlementActor, out: VisionSight) => {
  if (!actor.visible || actor.job === "Mount") return false;
  if (!Number.isFinite(actor.x) || !Number.isFinite(actor.z)) return false;
  const soldier = sources.military?.soldierOf?.(actor.uid);
  if (soldier) {
    out.faction = soldier.combat?.faction ?? 0;
    out.radius = soldierSight(sources, soldier);
    return true;
  }
  out.faction = civilianOwnerOf(actor);
  out.radius = actor.job === "Scout" ? SCOUT_SIGHT : CIVILIAN_SIGHT;
  return true;
};

/**
 * Finished headquarters see; a finished garrison building (either side) sees only with a soldier inside
 * (`garrisoned`). The lookout has no live sight: it only charts (player-fog.ts).
 */
export const buildingSight = (building: SettlementBuilding, garrisoned: boolean, out: VisionSight) => {
  if (building.construction < 1) return false;
  out.faction = ownerOf(building);
  if (isHomeBuilding(building)) { out.radius = HEADQUARTERS_SIGHT; return true; }
  if (!garrisoned || GARRISON_CAPACITIES[building.typeId] === undefined) return false;
  out.radius = GARRISON_BUILDING_SIGHT;
  return true;
};

/** A player exploration ship under way sees around it (its scouts on deck); other ships do not. */
export const shipSight = (ship: Pick<NavalShip, "exploration" | "phase" | "x" | "z">, out: VisionSight) => {
  if (!ship.exploration || !EXPLORER_SIGHT_PHASES.has(ship.phase)) return false;
  if (!Number.isFinite(ship.x) || !Number.isFinite(ship.z)) return false;
  out.faction = 0;
  out.radius = EXPLORER_SHIP_SIGHT;
  return true;
};
