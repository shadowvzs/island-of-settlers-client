import type { ScriptEventKind } from "../../../../island-of-settlers-shared/src/script/catalog/events";
import type { ScriptEventActor } from "../../../../island-of-settlers-shared/src/script/types/emission";
import type { ActorHandleValue, ScriptValue } from "../../../../island-of-settlers-shared/src/script/types/values";
import { getBuilding } from "../settlement/settlement-building-index";
import { ownerOf } from "../settlement/settlement-ownership";
import {
  isRoadWorkShell, type SettlementActor, type SettlementBuilding, type SettlementContext
} from "../settlement/settlement-types";
import { HUMAN_FACTION } from "../world/scenario-players";
import { describeBuilding, describeBuildingUid, describeUnit } from "./script-actors";
import { describeDamageSource, listening, type ScriptDamageSource } from "./script-unit-events";

/**
 * Building emission sites (design §5.1.3, TRG3a): construction placed and completed, upgraded, destroyed (HP 0)
 * versus demolished by the owner, damaged with its attacker, occupied by its worker, ware produced, clicked (the
 * player's recorded `select` only) and gone. Same contract as the unit helpers: the bit test comes first.
 */

type Responses = Record<string, ScriptValue | ActorHandleValue>;

const emitBuilding = (
  context: SettlementContext, kind: ScriptEventKind, building: SettlementBuilding,
  extra: { actors?: Record<string, ScriptEventActor>; responses?: Responses; values?: Record<string, number | string> }
    = {}
) => {
  if (!listening(context, kind) || isRoadWorkShell(building)) return;
  const site = describeBuilding(context, building);
  if (!site) return;
  context.script!.emit({
    actors: { ...extra.actors, building: site }, kind, player: site.owner,
    responses: { building: site.handle, ...extra.responses }, ...(extra.values ? { values: extra.values } : {})
  });
};

const number = (value: number) => ({ type: "number" as const, value });

/** The computer factions' own building events (enemy economy AI plan §5.2, EAI4c): never the player's. */
const emitFactionBuilding = (
  context: SettlementContext, kind: "factionBuildingCompleted" | "factionBuildingStarted",
  building: SettlementBuilding
) => {
  if (ownerOf(building) !== HUMAN_FACTION) emitBuilding(context, kind, building);
};

export const emitConstructionPlaced = (context: SettlementContext, building: SettlementBuilding) => {
  emitBuilding(context, "constructionPlaced", building);
  emitFactionBuilding(context, "factionBuildingStarted", building);
};

export const emitConstructionCompleted = (context: SettlementContext, building: SettlementBuilding) => {
  emitBuilding(context, "constructionCompleted", building);
  emitFactionBuilding(context, "factionBuildingCompleted", building);
};

/**
 * A force of a computer faction sets out to attack (EAI4c): `target` is the building it goes for, when its order
 * names one (a building the faction knows).
 */
export const emitFactionAttackLaunched = (context: SettlementContext, faction: number, target?: number) => {
  if (!listening(context, "factionAttackLaunched")) return;
  const site = describeBuildingUid(context, target);
  context.script!.emit({
    kind: "factionAttackLaunched", player: faction, ...(site ? { responses: { targetActor: site.handle } } : {})
  });
};

/** A workshop reached upgrade level `level` (1..5, the catalog's level axis). */
export const emitBuildingUpgraded = (context: SettlementContext, building: SettlementBuilding) => {
  const level = 1 + (building.workshopUpgrade?.level ?? 0);
  emitBuilding(context, "buildingUpgraded", building, { responses: { amount: number(level) }, values: { level } });
};

/** HP 0 in an assault (`destroyed`, killer = last attacker) or demolished by its owner (`demolished`). */
export const emitBuildingDestroyed = (
  context: SettlementContext, building: SettlementBuilding, cause: "destroyed" | "demolished",
  source?: ScriptDamageSource
) => {
  if (!listening(context, "buildingDestroyed")) return;
  const killer = describeDamageSource(context, source);
  emitBuilding(context, "buildingDestroyed", building, {
    responses: killer ? { killingActor: killer.handle } : {}, values: { cause }
  });
};

/** Walls struck: subject = the building, `source` = the attacker when known. */
export const emitBuildingDamaged = (
  context: SettlementContext, buildingUid: number, source: ScriptDamageSource | undefined,
  health: { after: number; before: number; maximum: number }
) => {
  if (!listening(context, "actorDamaged") || health.maximum <= 0) return;
  const building = getBuilding(context, buildingUid), site = building && describeBuilding(context, building);
  if (!site) return;
  const attacker = describeDamageSource(context, source);
  context.script!.emit({
    actors: attacker ? { source: attacker, subject: site } : { subject: site }, kind: "actorDamaged",
    player: site.owner,
    responses: {
      amount: number(health.before - health.after), triggeringActor: site.handle,
      ...(attacker ? { killingActor: attacker.handle } : {})
    },
    values: { percent: health.after / health.maximum * 100, percentBefore: health.before / health.maximum * 100 }
  });
};

/** The worker of a workplace arrived and started its shift there for the first time. */
export const emitBuildingOccupied = (context: SettlementContext, building: SettlementBuilding,
  worker: SettlementActor) => {
  if (!listening(context, "buildingOccupied")) return;
  const job = describeUnit(context, context.script!.generations, worker);
  if (!job) return;
  emitBuilding(context, "buildingOccupied", building, {
    actors: { job }, responses: { triggeringActor: job.handle }
  });
};

/** A production cycle finished with one batch of `ware`: `amount` units (a boat haul is several fish). */
export const emitWareProduced = (
  context: SettlementContext, building: SettlementBuilding, ware: string | undefined, amount = 1
) => {
  if (ware === undefined) return;
  emitBuilding(context, "wareProduced", building, {
    responses: { amount: number(amount), ware: { type: "string", value: ware } }, values: { ware }
  });
};

/** The player's recorded selection of a building (script-originated focus never selects, design M16). */
export const emitBuildingClicked = (context: SettlementContext, uid: number | null) => {
  if (uid === null || !listening(context, "actorClicked")) return;
  const building = getBuilding(context, uid), site = building && describeBuilding(context, building);
  if (!site) return;
  context.script!.emit({
    actors: { subject: site }, kind: "actorClicked", player: site.owner, responses: { triggeringActor: site.handle }
  });
};

/** A building left the world (demolished, fallen ruin cleared, captured): "gone" and the clean-up. */
export const emitBuildingGone = (context: SettlementContext, building: SettlementBuilding, destroyed: boolean) => {
  const script = context.script;
  if (!script || isRoadWorkShell(building)) return;
  const site = describeBuilding(context, building);
  if (!site) return;
  const reason = destroyed ? "died" : "despawned";
  if (script.isSubscribed("actorGone")) {
    script.emit({
      actors: { subject: site }, kind: "actorGone", player: site.owner,
      responses: { outcome: { type: "string", value: reason }, triggeringActor: site.handle }, values: { reason }
    });
  }
  script.gone(site.handle, reason);
};
