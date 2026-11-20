import { familyMatches } from "@shared/catalog";

import type {
  ScriptEvalScope, ScriptEvalValue, ScriptWorldPort
} from "../../../../island-of-settlers-shared/src/script/engine/ports";
import type { ScriptPredicateKind } from "../../../../island-of-settlers-shared/src/script/catalog/predicates";
import type {
  ActorQuery, ActorSelector, ActorTypeRef
} from "../../../../island-of-settlers-shared/src/script/types/actors";
import type { PlayerFilter, ScriptRef } from "../../../../island-of-settlers-shared/src/script/types/refs";
import type { PredicateArg } from "../../../../island-of-settlers-shared/src/script/types/triggers";
import type {
  ActorHandleValue, Expr, FunctionArg, ScriptFunctionKind
} from "../../../../island-of-settlers-shared/src/script/types/values";
import { DMath } from "../math/deterministic-math";
import { militaryHealth } from "../settlement/military-combat-rules";
import { getBuilding } from "../settlement/settlement-building-index";
import type { SettlementContext } from "../settlement/settlement-types";
import { HUMAN_FACTION } from "../world/scenario-players";
import { isContained, type RegionSpot } from "./cell-watch";
import { BUILDING_POOL } from "./constants";
import { isNatureSpace } from "./nature/nature-actors";
import { findUnit } from "./script-actors";
import { createSettlementQuestPort } from "./script-quest-port";
import type { ScriptMember, ScriptMembers } from "./script-world-members";
import { scriptWeatherOf } from "./world-environment";

/**
 * The settlement implementation of `ScriptWorldPort` for units and buildings (TRG3a, design §6.1, §6.7): handle
 * liveness, type/family/owner/region queries with the four picks, and the read-only functions and predicates
 * over them, and the world environment's hour, weather and season (ENV0). World actions are TRG5: until then every
 * action request ends `refused`. Nature (TRG3b) resolves through the members' nature view; ships and wares answer
 * "nothing" until TRG3c/d map them.
 */

const lit = (value: number): Expr => ({ k: "lit", type: "number", value });

const asSelector = (arg: FunctionArg | PredicateArg | undefined) => arg as ActorSelector | undefined;
const asRef = (arg: FunctionArg | PredicateArg | undefined) => arg as ScriptRef | undefined;

const evaluateString = (scope: ScriptEvalScope, arg: PredicateArg | undefined) => {
  const value = arg === undefined ? undefined : scope.evaluate(arg as Expr);
  return typeof value === "string" ? value : undefined;
};

const evaluateNumber = (scope: ScriptEvalScope, arg: FunctionArg | PredicateArg | undefined) => {
  if (arg === undefined) return undefined;
  const value = scope.evaluate(arg as Expr);
  return typeof value === "number" ? value : undefined;
};

/** Where a live unit, building or nature object stands now (direct lookups: event filters must not scan). */
export const scriptSpotOf = (
  context: SettlementContext, members: ScriptMembers, handle: ActorHandleValue
): RegionSpot | undefined => {
  if (isNatureSpace(handle.space)) return members.member(handle);
  if (handle.space === "building") {
    const building = getBuilding(context, handle.id);
    return building && { contained: false, x: building.x, z: building.z };
  }
  if (handle.space !== "actor") return undefined;
  const actor = findUnit(context, handle.id);
  return actor && { contained: isContained(actor), x: actor.x, z: actor.z };
};

export const createSettlementWorldPort = (
  context: SettlementContext, members: ScriptMembers, performAction: ScriptWorldPort["performAction"]
): ScriptWorldPort => {
  const teamOf = (faction: number) =>
    context.options.world.scenario?.players?.find(slot => slot.faction === faction)?.team ?? faction;
  const resolved = (scope: ScriptEvalScope, arg: FunctionArg | PredicateArg | undefined): ScriptMember[] => {
    const selector = asSelector(arg);
    if (!selector) return [];
    return scope.resolveActors(selector).flatMap(handle => members.member(handle) ?? []);
  };
  const first = (scope: ScriptEvalScope, arg: FunctionArg | PredicateArg | undefined) => resolved(scope, arg)[0];
  const health = (entry: ScriptMember | undefined) => {
    const soldier = entry && context.military?.soldierOf?.(entry.actor.handle.id);
    if (entry?.actor.handle.space !== "actor" || !soldier?.combat) return null;
    return { hp: soldier.combat.hp, maximum: militaryHealth(soldier.combat.type, soldier.rank) };
  };
  const nearestTo = (candidates: ScriptMember[], pick: Extract<ActorQuery["pick"], { kind: "nearest" }>,
    scope: ScriptEvalScope) => {
    const origin = originOf(pick.to, scope);
    if (!origin) return [];
    let best: ScriptMember | undefined, bestDistance = Infinity;
    for (const candidate of candidates) {
      const distance = DMath.hypot(candidate.x - origin.x, candidate.z - origin.z);
      if (distance < bestDistance) { best = candidate; bestDistance = distance; }
    }
    return best ? [best] : [];
  };
  const originOf = (to: ActorSelector | ScriptRef<"region">, scope: ScriptEvalScope) => {
    if ("k" in to) return regionCentre(to.id);
    return first(scope, to);
  };
  const regionCentre = (id: string) => {
    const shape = members.region(id)?.shape;
    if (!shape) return undefined;
    if (shape.kind === "rect") return { x: (shape.minX + shape.maxX) / 2, z: (shape.minZ + shape.maxZ) / 2 };
    if (shape.kind === "circle") return { x: shape.centerX, z: shape.centerZ };
    return { x: shape.x, z: shape.z };
  };
  const sortedMembers = (list: ScriptMember[]) => list.slice().sort((a, b) => a.actor.handle.id - b.actor.handle.id);
  const queryMembers = (query: ActorQuery, limit: number, scope: ScriptEvalScope) => {
    const pool = query.from.kind === "type" || query.from.kind === "family"
      ? members.select(query.from) : resolved(scope, query.from);
    const candidates = sortedMembers(pool).slice(0, Math.min(limit, query.limit ?? limit));
    switch (query.pick.kind) {
      case "all": return candidates;
      case "first": return candidates.slice(0, 1);
      case "nearest": return nearestTo(candidates, query.pick, scope);
      case "random": {
        if (!candidates.length) return [];
        const index = scope.evaluate({ args: { max: lit(candidates.length - 1), min: lit(0) }, fn: "random", k: "fn" });
        return [candidates[typeof index === "number" ? index : 0]!];
      }
    }
  };
  const countBuildings = (args: Record<string, FunctionArg>, scope: ScriptEvalScope) => {
    const type = args.type as unknown as ActorTypeRef | undefined, level = evaluateNumber(scope, args.level);
    const owner = args.owner as PlayerFilter | undefined;
    if (!type) return 0;
    return members.select({ kind: "type", owner, type }).filter(entry =>
      level === undefined || (entry.actor.qualifiers?.level ?? 1) >= level).length;
  };
  const countSoldiers = (args: Record<string, FunctionArg>, scope: ScriptEvalScope) => {
    const type = args.type as unknown as ActorTypeRef | undefined, rank = evaluateNumber(scope, args.rank);
    const owner = args.owner as PlayerFilter | undefined;
    const pool = type ? members.select({ kind: "type", owner, type })
      : members.select({ family: { id: "soldier", k: "ref", kind: "family" }, kind: "family", owner });
    return pool.filter(entry => rank === undefined || entry.actor.qualifiers?.rank === rank).length;
  };
  /** Buildings of the faction (sites included, like `buildingCount`), of one type when `type` is set. */
  const countFactionBuildings = (args: Record<string, FunctionArg>) => {
    const type = args.type as unknown as ActorTypeRef | undefined, owner = args.faction as PlayerFilter | undefined;
    if (!owner) return 0;
    if (type) return members.select({ kind: "type", owner, type }).length;
    return members.pool(BUILDING_POOL).filter(entry => members.ownerMatches(owner, entry.actor)).length;
  };
  const postureOf = (args: Record<string, FunctionArg>) => {
    const owner = args.faction as PlayerFilter | undefined;
    return owner?.kind === "slot" ? context.factionAi?.posture(owner.faction) ?? null : null;
  };
  const functions: Partial<Record<ScriptFunctionKind,
    (args: Record<string, FunctionArg>, scope: ScriptEvalScope) => ScriptEvalValue>> = {
    buildingCount: countBuildings,
    count: (args, scope) => resolved(scope, args.selector).length,
    countInRegion: (args, scope) => resolved(scope, args.selector)
      .filter(entry => members.inRegion(asRef(args.region)?.id, entry)).length,
    distance: (args, scope) => {
      const a = first(scope, args.a), b = first(scope, args.b);
      return a && b ? DMath.hypot(a.x - b.x, a.z - b.z) : null;
    },
    factionBuildingCount: countFactionBuildings,
    factionPosture: postureOf,
    factionSoldierCount: (args, scope) => (args.faction ? countSoldiers({ owner: args.faction }, scope) : 0),
    health: (args, scope) => health(first(scope, args.actor))?.hp ?? null,
    healthPercent: (args, scope) => {
      const value = health(first(scope, args.actor));
      return value ? value.hp / value.maximum * 100 : null;
    },
    hour: () => context.script?.environmentReading()?.hour ?? null,
    isAlive: (args, scope) => resolved(scope, args.actor).length > 0,
    isHidden: (args, scope) => first(scope, args.actor)?.hidden ?? false,
    owner: (args, scope) => first(scope, args.actor)?.actor.owner ?? null,
    soldierCount: countSoldiers,
    typeOf: (args, scope) => first(scope, args.actor)?.actor.type ?? null
  };
  const everyMember = (
    scope: ScriptEvalScope, arg: PredicateArg | undefined, test: (entry: ScriptMember) => boolean
  ) => {
    const list = resolved(scope, arg);
    return list.length > 0 && list.every(test);
  };
  const predicates: Partial<Record<ScriptPredicateKind,
    (args: Record<string, PredicateArg>, scope: ScriptEvalScope) => boolean>> = {
    actorAlive: (args, scope) => resolved(scope, args.actor).length > 0,
    actorHidden: (args, scope) => everyMember(scope, args.actor, entry => entry.hidden),
    actorInRegion: (args, scope) =>
      everyMember(scope, args.actor, entry => members.inRegion(asRef(args.region)?.id, entry)),
    actorIsFamily: (args, scope) => everyMember(scope, args.actor,
      entry => familyMatches(asRef(args.family)?.id ?? "", entry.actor.family)),
    actorIsType: (args, scope) => everyMember(scope, args.actor,
      entry => members.ofType(args.type as unknown as ActorTypeRef, entry)),
    actorOwnedBy: (args, scope) => everyMember(scope, args.actor,
      entry => args.player !== undefined && members.ownerMatches(args.player as PlayerFilter, entry.actor)),
    seasonIs: (args, scope) => {
      const season = context.script?.environment?.season();
      return season !== undefined && evaluateString(scope, args.season) === season;
    },
    weatherIs: (args, scope) => {
      const reading = context.script?.environmentReading();
      return reading !== undefined && evaluateString(scope, args.weather) === scriptWeatherOf(reading.weather);
    }
  };
  return {
    ...createSettlementQuestPort(context),
    actorInRegion: (handle, regionId) => {
      const spot = scriptSpotOf(context, members, handle);
      return spot !== undefined && members.inRegion(regionId, spot);
    },
    callFunction: (fn, args, scope) => functions[fn]?.(args, scope) ?? null,
    /** CIN4: a held sequence ended; the hour change its pause froze completes (ENV0 world environment). */
    cinematicEnded: ({ hold }) => {
      const script = context.script;
      if (hold && script?.environment) script.environment.settle(script.engine.state.scriptTick);
    },
    gameNow: () => context.clock?.now() ?? 0,
    gameTick: () => context.clock?.tick() ?? 0,
    isHandleLive: (handle: ActorHandleValue) => members.member(handle) !== undefined,
    /** Campaign maps: victory or defeat is decided, so a sequence queued now is an outcome sequence (CIN4). */
    mapOutcomeDecided: () => context.campaignMap?.outcome !== undefined,
    performAction,
    /** Every player slot of the map (the human first), ascending; multiboard player rows list them (TRG8). */
    playerFactions: () => {
      const factions = new Set([HUMAN_FACTION, ...(context.options.world.scenario?.players ?? [])
        .map(slot => slot.faction)]);
      return [...factions].sort((a, b) => a - b);
    },
    playerIsHuman: faction => faction === HUMAN_FACTION,
    playersAllied: (a, b) => a === b || teamOf(a) === teamOf(b),
    queryActors: (selector, limit, scope) => {
      const found = selector.kind === "query" ? queryMembers(selector.query, limit, scope)
        : sortedMembers(members.select(selector)).slice(0, limit);
      return found.map(entry => entry.actor.handle);
    },
    spotInRegion: (x, z, regionId) => members.inRegion(regionId, { contained: false, x, z }),
    testPredicate: (pred, args, scope) => predicates[pred]?.(args, scope) ?? false
  };
};
