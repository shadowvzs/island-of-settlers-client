import type { CampaignVictoryRule } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  type MapRegion, regionContainsCell, type RegionShape
} from "../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import { HEADQUARTERS_TYPE_ID } from "../settlement/building-type-ids";
import { isSaveInteger, isSaveObject } from "../settlement/save-validation";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../settlement/settlement-types";

/**
 * Built-in victory rules of a campaign map (C9b, review R17/R34). The map record's rule is resolved at the start
 * (regions become their shapes) and saved with the map progress, so a reload never needs the record. A building
 * counts as destroyed at its fall (structure HP 0), never at ruin removal. Waves are authored by the map script, so
 * `surviveWaves` (and any rule the script owns) is `scripted`: only the script's `endMap` decides it.
 */

/** Cells around the landing harbour an enemy soldier must stay out of while `holdArea` holds the harbour. */
export const LANDING_HARBOUR_HOLD_RADIUS = 12;

export type CampaignVictoryCheck =
  | { kind: "destroyHeadquarters" | "eliminateArmy" | "scripted" | "totalVictory" }
  /** `buildingId` is the authored scenario building id (resolved through the map start's object table). */
  | { buildingId: number; kind: "destroyTarget" }
  /** No `region`: the landing harbour. */
  | { kind: "hold"; region?: RegionShape; seconds: number }
  | { kind: "surviveTime"; seconds: number };

/** The record's rule as the run checks it; a hold on an unknown region is an authoring error. */
export const campaignVictoryCheck = (
  rule: CampaignVictoryRule, regions: readonly MapRegion[] = []
): CampaignVictoryCheck => {
  if (rule.kind === "surviveWaves") return { kind: "scripted" };
  if (rule.kind !== "holdArea") return structuredClone(rule);
  if (rule.target.kind === "landingHarbour") return { kind: "hold", seconds: rule.seconds };
  const { regionId } = rule.target;
  const region = regions.find(entry => entry.id === regionId);
  if (!region) throw new Error(`Victory rule region ${regionId} is missing`);
  return { kind: "hold", region: structuredClone(region.shape), seconds: rule.seconds };
};

/** What the checks read from the running island. */
export interface CampaignVictoryWorld {
  actor: (uid: number) => SettlementActor | undefined;
  /** Standing: present and not fallen (structure HP above 0). */
  standing: (uid: number) => boolean;
  /** Living soldiers: faction and actor uid. */
  soldiers: readonly { actor: number; faction: number }[];
  /** Seconds since the map started. */
  seconds: number;
  targetUid: (buildingId: number) => number | undefined;
}

const isEnemy = (faction: number | undefined) => (faction ?? 0) > 0;

const enemyBuildingStanding = (
  buildings: readonly SettlementBuilding[], world: CampaignVictoryWorld, type?: number
) => buildings.some(site => isEnemy(site.militaryFaction) && (type === undefined || site.typeId === type) &&
  world.standing(site.uid));

const enemySoldierAlive = (world: CampaignVictoryWorld) => world.soldiers.some(soldier => isEnemy(soldier.faction));

const inside = (world: CampaignVictoryWorld, uid: number, area: (actor: SettlementActor) => boolean) => {
  const actor = world.actor(uid);
  return actor !== undefined && area(actor);
};

/** Whether the hold area is held now: no enemy inside; a region also needs one of the player's soldiers in it. */
const holdsArea = (world: CampaignVictoryWorld, area: (actor: SettlementActor) => boolean, needsOwn: boolean) => {
  let own = !needsOwn;
  for (const soldier of world.soldiers) {
    if (!inside(world, soldier.actor, area)) continue;
    if (isEnemy(soldier.faction)) return false;
    own = true;
  }
  return own;
};

const harbourArea = (harbour: SettlementBuilding | undefined) => (actor: SettlementActor) => {
  if (!harbour) return false;
  const dx = actor.x - harbour.x, dz = actor.z - harbour.z;
  return dx * dx + dz * dz <= LANDING_HARBOUR_HOLD_RADIUS * LANDING_HARBOUR_HOLD_RADIUS;
};

/** Whether the hold check holds now (the caller counts the held seconds). */
export const campaignHoldsArea = (
  check: Extract<CampaignVictoryCheck, { kind: "hold" }>, world: CampaignVictoryWorld,
  harbour: SettlementBuilding | undefined
) => {
  const region = check.region;
  if (!region) return holdsArea(world, harbourArea(harbour), false);
  return holdsArea(world, actor => regionContainsCell({ shape: region }, actor.x, actor.z), true);
};

/** Whether a rule without held time is met now (`hold` is counted by the caller, `scripted` never is). */
export const campaignRuleMet = (
  check: CampaignVictoryCheck, context: Pick<SettlementContext, "buildings">, world: CampaignVictoryWorld
) => {
  if (check.kind === "eliminateArmy") return !enemySoldierAlive(world);
  if (check.kind === "totalVictory")
    return !enemySoldierAlive(world) && !enemyBuildingStanding(context.buildings, world);
  if (check.kind === "destroyHeadquarters")
    return !enemyBuildingStanding(context.buildings, world, HEADQUARTERS_TYPE_ID);
  if (check.kind === "surviveTime") return world.seconds >= check.seconds;
  if (check.kind !== "destroyTarget") return false;
  const uid = world.targetUid(check.buildingId);
  return uid !== undefined && !world.standing(uid);
};

const KINDS = new Set(["destroyHeadquarters", "eliminateArmy", "scripted", "totalVictory"]);

const isShape = (value: unknown) => isSaveObject(value) && ["circle", "point", "rect"].includes(value.kind as string);

/** Whether a saved victory check is well formed. */
export const isCampaignVictoryCheck = (value: unknown): value is CampaignVictoryCheck => {
  if (!isSaveObject(value)) return false;
  if (KINDS.has(value.kind as string)) return true;
  if (value.kind === "destroyTarget") return isSaveInteger(value.buildingId);
  if (value.kind === "surviveTime") return isSaveInteger(value.seconds);
  if (value.kind !== "hold" || !isSaveInteger(value.seconds)) return false;
  return value.region === undefined || isShape(value.region);
};
