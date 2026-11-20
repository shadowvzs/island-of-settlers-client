import { buildingEntry, commanderEntry, settlerByJob, soldierEntry } from "@shared/catalog";

import type { ScriptEventActor } from "../../../../island-of-settlers-shared/src/script/types/emission";
import type { ActorHandleValue } from "../../../../island-of-settlers-shared/src/script/types/values";
import { getBuilding } from "../settlement/settlement-building-index";
import type { SettlementSoldier } from "../settlement/settlement-military";
import { civilianOwnerOf, ownerOf } from "../settlement/settlement-ownership";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../settlement/settlement-types";

/**
 * How the map script sees settlement objects (trigger design §3.2, §6.7): a generation-counted handle, the catalog
 * type and family path, the owning faction and the type qualifiers. Units live in the `actor` handle space (their
 * uid), buildings in `building`. A retired settler shell is reused by `createActor` under the same uid, so the uid
 * carries a generation (`ScriptGenerations`) that grows whenever the person behind it is gone.
 */

/** Sparse per-uid generations of reused unit shells (absent = 0); saved with the script state. */
export type ScriptGenerations = Map<number, number>;

const FALLBACK_SETTLER = "Settler";

export const unitHandle = (generations: ScriptGenerations, uid: number): ActorHandleValue =>
  ({ generation: generations.get(uid) ?? 0, id: uid, space: "actor" });

export const buildingHandle = (uid: number): ActorHandleValue => ({ generation: 0, id: uid, space: "building" });

/** The nation of a faction's look: the player's nation for faction 0, unknown for computer factions. */
const nationOf = (context: SettlementContext, faction: number) => faction === 0 ? context.playerNation : undefined;

const soldierActor = (
  context: SettlementContext, handle: ActorHandleValue, soldier: SettlementSoldier
): ScriptEventActor | undefined => {
  const owner = soldier.combat?.faction ?? 0;
  const nation = context.script?.actions.lookOf(handle.id) ?? nationOf(context, owner);
  if (soldier.commanderId !== undefined) {
    const entry = commanderEntry(nation ?? "roman");
    return entry && { family: entry.family, handle, owner, type: entry.id };
  }
  const entry = soldierEntry(soldier.combat?.type ?? "shield");
  if (!entry) return undefined;
  return { family: entry.family, handle, owner, qualifiers: { nation, rank: soldier.rank }, type: entry.id };
};

const settlerActor = (handle: ActorHandleValue, actor: SettlementActor): ScriptEventActor | undefined => {
  const entry = settlerByJob(actor.job) ?? settlerByJob(FALLBACK_SETTLER);
  if (!entry) return undefined;
  return { family: entry.family, handle, owner: civilianOwnerOf(actor), type: entry.id };
};

/** A unit (settler, soldier, commander) as an event actor; undefined for unknown records. */
export const describeUnit = (
  context: SettlementContext, generations: ScriptGenerations, actor: SettlementActor
): ScriptEventActor | undefined => {
  const handle = unitHandle(generations, actor.uid);
  const soldier = context.military?.soldierOf?.(actor.uid);
  if (soldier) return soldierActor(context, handle, soldier);
  return settlerActor(handle, actor);
};

/** A building as an event actor: catalog entry by type code, level 1..5 from its workshop upgrade. */
export const describeBuilding = (
  context: SettlementContext, building: SettlementBuilding
): ScriptEventActor | undefined => {
  const entry = buildingEntry(building.typeId);
  if (!entry) return undefined;
  const owner = ownerOf(building);
  const level = 1 + (building.workshopUpgrade?.level ?? 0);
  return {
    family: entry.family, handle: buildingHandle(building.uid), owner,
    qualifiers: { level, nation: nationOf(context, owner) }, type: entry.id
  };
};

/** A building by uid as an event actor (undefined when it is gone). */
export const describeBuildingUid = (context: SettlementContext, uid: number | undefined) => {
  const building = getBuilding(context, uid);
  return building && describeBuilding(context, building);
};

/** The unit record behind a uid, also while it is inside a building (never a retired shell). */
export const findUnit = (context: SettlementContext, uid: number | undefined) => {
  if (uid === undefined) return undefined;
  const actor = context.actors.find(entry => entry.uid === uid);
  return actor && actor.phase !== "retired" ? actor : undefined;
};
