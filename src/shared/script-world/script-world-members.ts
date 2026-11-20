import { familyMatches } from "@shared/catalog";

import { playerFilterMatches } from "../../../../island-of-settlers-shared/src/script/engine/event-matching";
import type { ScriptWorldPort } from "../../../../island-of-settlers-shared/src/script/engine/ports";
import { qualifiersMatch } from "../../../../island-of-settlers-shared/src/script/engine/subscriptions";
import type { ActorSelector, ActorTypeRef } from "../../../../island-of-settlers-shared/src/script/types/actors";
import type { ScriptEventActor } from "../../../../island-of-settlers-shared/src/script/types/emission";
import type { PlayerFilter } from "../../../../island-of-settlers-shared/src/script/types/refs";
import type { MapScript } from "../../../../island-of-settlers-shared/src/script/types/script";
import type { ActorHandleValue } from "../../../../island-of-settlers-shared/src/script/types/values";
import { isRoadWorkShell, type SettlementContext } from "../settlement/settlement-types";
import { isContained, type RegionSpot, spotInRegion } from "./cell-watch";
import { isNatureSpace, type NatureGenerations } from "./nature/nature-actors";
import { createNatureMembers, NATURE_KINDS } from "./nature/nature-members";
import { describeBuilding, describeUnit, type ScriptGenerations } from "./script-actors";

/**
 * The script's view of the island's units and buildings (TRG3a world port, design §4.3, §6.7): every live member
 * with its description and position, the handle lookups, and the type/family/owner/region filters of actor
 * selectors. Built lazily once per engine entry (`invalidate` between entries), so a run that counts or queries
 * many times scans the island at most once per tick, and an island whose script never asks never scans.
 */

export interface ScriptMember extends RegionSpot {
  actor: ScriptEventActor;
  hidden: boolean;
}

/** Unit kinds of the catalog (nature kinds: `nature-members.ts`; ships and wares follow in TRG3c/d). */
const UNIT_KINDS = new Set(["settler", "soldier", "commander"]);
const BUILDING_KIND = "building";

const kindOf = (id: string) => id.slice(0, Math.max(0, id.indexOf(":")));
const familyKind = (family: string) => family.split(".")[0] ?? "";

const memberKey = (handle: ActorHandleValue) => `${handle.space}:${handle.id}`;

export const createScriptMembers = (
  context: SettlementContext, generations: ScriptGenerations, script: () => MapScript, port: () => ScriptWorldPort,
  natureGenerations: NatureGenerations, isScriptHidden: (uid: number) => boolean = () => false
) => {
  const nature = createNatureMembers(context, natureGenerations);
  let units: ScriptMember[] | null = null;
  let buildings: ScriptMember[] | null = null;
  let byKey: Map<string, ScriptMember> | null = null;
  const unitMembers = () => units ??= context.actors.flatMap(actor => {
    if (actor.phase === "retired") return [];
    const described = describeUnit(context, generations, actor);
    return described
      ? [{ actor: described, contained: isContained(actor), hidden: !actor.visible, x: actor.x, z: actor.z }] : [];
  });
  const buildingMembers = () => buildings ??= context.buildings.flatMap(building => {
    if (isRoadWorkShell(building)) return [];
    const described = describeBuilding(context, building);
    return described ? [{ actor: described, contained: false, hidden: false, x: building.x, z: building.z }] : [];
  });
  const lookup = () => byKey ??= new Map([...unitMembers(), ...buildingMembers()]
    .map(member => [memberKey(member.actor.handle), member]));
  /** The live member a handle names; a stale generation or a removed object is gone. */
  const member = (handle: ActorHandleValue) => {
    if (isNatureSpace(handle.space)) return nature.member(handle);
    const found = lookup().get(memberKey(handle));
    return found?.actor.handle.generation === handle.generation ? found : undefined;
  };
  const pool = (kind: string) => {
    if (UNIT_KINDS.has(kind)) return unitMembers();
    if (NATURE_KINDS.has(kind)) return nature.pool(kind);
    return kind === BUILDING_KIND ? buildingMembers() : [];
  };
  const ownerMatches = (filter: PlayerFilter | undefined, actor: ScriptEventActor) =>
    !filter || playerFilterMatches({ port: port() }, filter, actor.owner);
  const region = (id: string) => script().regions.find(candidate => candidate.id === id);
  /** Cell membership, as the region watch announces it (TRG4); contained people stand in no region. */
  const inRegion = (regionId: string | undefined, entry: RegionSpot) => {
    if (regionId === undefined) return true;
    const found = region(regionId);
    return found !== undefined && spotInRegion(found, entry);
  };
  const ofType = (type: ActorTypeRef, entry: ScriptMember) =>
    entry.actor.type === type.type.id && qualifiersMatch(type, entry.actor.qualifiers);
  /** Live members of a type or family selector; units a story action hid are not matched (design §3.2). */
  const select = (selector: ActorSelector): ScriptMember[] =>
    selectAll(selector).filter(entry => entry.actor.handle.space !== "actor" || !isScriptHidden(entry.actor.handle.id));
  const selectAll = (selector: ActorSelector): ScriptMember[] => {
    if (selector.kind === "type") {
      return pool(kindOf(selector.type.type.id)).filter(entry => ofType(selector.type, entry) &&
        ownerMatches(selector.owner, entry.actor) && inRegion(selector.region?.id, entry));
    }
    if (selector.kind === "family") {
      const family = selector.family.id;
      return pool(familyKind(family)).filter(entry => familyMatches(family, entry.actor.family) &&
        ownerMatches(selector.owner, entry.actor) && inRegion(selector.region?.id, entry));
    }
    return [];
  };
  return {
    inRegion,
    invalidate: () => { units = null; buildings = null; byKey = null; nature.invalidate(); },
    member,
    ofType,
    ownerMatches,
    pool,
    region,
    select
  };
};

export type ScriptMembers = ReturnType<typeof createScriptMembers>;
