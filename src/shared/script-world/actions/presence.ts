import { splitContentId } from "@shared/catalog";

import type { MapRegion } from "../../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import type {
  ScriptActionRequest, ScriptActionResult
} from "../../../../../island-of-settlers-shared/src/script/engine/ports";
import type {
  ActorLook, ActorSelector, ActorTypeRef
} from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { ActorHandleValue } from "../../../../../island-of-settlers-shared/src/script/types/values";
import { isOrdinaryTroopType } from "../../settlement/military-combat-rules";
import { MAX_SOLDIER_RANK } from "../../settlement/settlement-military-ranks";
import { unitHandle } from "../script-actors";
import {
  booleanArg, factionArg, numberArg, regionCentre, regionFacing, regionOf, regionPlaces,
  type ScriptActionHost, scriptTickOf, stringArg, takeActionId, ticksOfMs, type UnitTarget, unitTargets
} from "./action-host";
import { type ScriptFade, setMember } from "./action-state";
import { DEGREES_TO_RADIANS, MAX_SPAWN_COUNT, SOLDIER_KIND } from "./constants";

/**
 * Presence actions (trigger design §5.2.1, TRG5a): spawn, appear, fade, despawn, kill, kill N, owner, hide and
 * invulnerability. v1 handles soldiers in the open field (the troop types of the catalog); commanders only take
 * the harmless ones (hide, fade in, invulnerable). Settlers, buildings, nature and ships answer `refused` until
 * their lanes add them (open points in the receipt).
 */

type Result = ScriptActionResult;

const REFUSED: Result = { kind: "failed", outcome: "refused" };
const GONE: Result = { kind: "failed", outcome: "actorGone" };
const DONE: Result = { kind: "done" };

export interface SpawnSpec {
  count: number;
  faction: number;
  /** Radians. */
  facing: number | undefined;
  look: ActorLook | undefined;
  region: MapRegion;
  type: ActorTypeRef;
}

const controlOf = (host: ScriptActionHost) => host.context.military?.scriptUnits;

const fieldSoldiers = (host: ScriptActionHost, targets: UnitTarget[]) =>
  targets.filter(target => controlOf(host)?.isFieldSoldier(target.handle.id));

const troopOf = (type: ActorTypeRef) => {
  const split = splitContentId(type.type.id);
  return split?.kind === SOLDIER_KIND && isOrdinaryTroopType(split.key) ? split.key : undefined;
};

const lookNation = (host: ScriptActionHost, uid: number, look: ActorLook | undefined) => {
  if (look?.kind !== "nation") return;
  host.state.looks.push(uid, look.nation);
};

/** A fade record per unit; all of one action share its id (the action ends with the last of them). */
const startFades = (host: ScriptActionHost, uids: readonly number[], fade: Omit<ScriptFade, "actor" |
  "endTick" | "startTick">, ms: number) => {
  const startTick = scriptTickOf(host), endTick = startTick + Math.max(1, ticksOfMs(ms));
  for (const actor of uids) host.state.fades.push({ ...fade, actor, endTick, startTick });
};

/** Done now, or pending until the fades end when the step waits for them. */
const fadedResult = (host: ScriptActionHost, request: ScriptActionRequest, uids: readonly number[], ms: number,
  direction: "in" | "out", then: ScriptFade["then"], clearVariables = false, spawned?: ActorHandleValue[]): Result => {
  if (ms <= 0 || uids.length === 0) return spawned ? { kind: "done", spawned } : DONE;
  const actionId = request.wait ? takeActionId(host) : null;
  startFades(host, uids, { actionId, clearVariables, direction, then }, ms);
  if (actionId === null) return spawned ? { kind: "done", spawned } : DONE;
  return spawned ? { actionId, kind: "pending", spawned } : { actionId, kind: "pending" };
};

/** Soldiers of a spawn spec on the region's free places (nearest to the centre first). */
export const spawnUnits = (host: ScriptActionHost, spec: SpawnSpec) => {
  const control = controlOf(host), troop = troopOf(spec.type);
  if (!control || !troop) return [];
  const rank = Math.min(MAX_SOLDIER_RANK, Math.max(0, Math.round(spec.type.rank?.min ?? 0)));
  const yaw = spec.facing ?? regionFacing(spec.region) ?? 0;
  const spawned: ActorHandleValue[] = [];
  for (const place of regionPlaces(host, spec.region)) {
    if (spawned.length >= spec.count) break;
    const uid = control.spawn(place, troop, rank, spec.faction, yaw);
    if (uid === null) continue;
    lookNation(host, uid, spec.look);
    spawned.push(unitHandle(host.generations, uid));
  }
  return spawned;
};

const spawn = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const { args, scope } = request;
  const faction = factionArg(args.owner), region = regionOf(host, args.at);
  if (faction === null || !region || !args.type) return REFUSED;
  const facing = args.facing ? numberArg(scope, args.facing, 0) * DEGREES_TO_RADIANS : undefined;
  const count = Math.min(MAX_SPAWN_COUNT, Math.max(1, Math.round(numberArg(scope, args.count, 1))));
  const spawned = spawnUnits(host, { count, faction, facing, look: args.look as ActorLook | undefined, region,
    type: args.type as unknown as ActorTypeRef });
  if (spawned.length === 0) return { kind: "failed", outcome: "blocked" };
  return fadedResult(host, request, spawned.map(handle => handle.id), numberArg(scope, args.fadeMs, 0), "in",
    "keep", false, spawned);
};

const unhide = (host: ScriptActionHost, target: UnitTarget) => {
  setMember(host.state.hidden, target.actor.uid, false);
  target.actor.visible = true;
};

const hideUnit = (host: ScriptActionHost, target: UnitTarget) => {
  setMember(host.state.hidden, target.actor.uid, true);
  target.actor.visible = false;
};

const isHidden = (host: ScriptActionHost, uid: number) => host.state.hidden.includes(uid);

/** Hidden members are shown (fading in); a spawn actor without live members spawns its spec. */
const appear = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const { args, scope } = request;
  const selector = args.actor as ActorSelector | undefined;
  const actorId = selector?.kind === "instance" ? selector.actor.id : undefined;
  const authored = host.engine().script.actors.find(actor => actor.id === actorId);
  if (!authored) return REFUSED;
  const fadeMs = numberArg(scope, args.fadeMs, 0);
  const members = unitTargets(host, scope, args.actor);
  const hidden = members.filter(target => isHidden(host, target.actor.uid));
  const binding = host.engine().state.actors[authored.id] ??= { incarnation: 0, members: [] };
  if (hidden.length) {
    for (const target of hidden) unhide(host, target);
    if (binding.incarnation === 0) binding.incarnation = 1;
    return fadedResult(host, request, hidden.map(target => target.actor.uid), fadeMs, "in", "keep");
  }
  if (authored.binding !== "spawn") return members.length ? DONE : GONE;
  if (members.length && authored.respawn === "refuse") return REFUSED;
  const region = host.members.region(authored.place.region.id);
  if (!region || authored.owner.kind !== "slot") return REFUSED;
  const spawned = spawnUnits(host, { count: authored.count, faction: authored.owner.faction,
    facing: authored.place.facing, look: authored.look, region, type: authored.type });
  if (spawned.length === 0) return { kind: "failed", outcome: "blocked" };
  if (members.length === 0) binding.incarnation += 1;
  binding.members.push(...spawned.map(handle => ({ handle, scripted: false, state: "alive" as const })));
  host.engine().rebuildInstanceIndex();
  return fadedResult(host, request, spawned.map(handle => handle.id), fadeMs, "in", "keep", false, spawned);
};

/** Hidden members fade in; shown ones fade out, then stay hidden or leave the world. */
const fade = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const { args, scope } = request;
  const targets = fieldSoldiers(host, unitTargets(host, scope, args.actor));
  if (targets.length === 0) return GONE;
  const ms = numberArg(scope, args.ms, 0);
  const then = stringArg(scope, args.then, "keep") === "remove" ? "remove" : "keep";
  const clear = booleanArg(scope, args.clearVariables, false);
  const hiddenNow = targets.filter(target => isHidden(host, target.actor.uid));
  const shown = targets.filter(target => !isHidden(host, target.actor.uid));
  for (const target of hiddenNow) unhide(host, target);
  if (ms <= 0) {
    for (const target of shown) finishFadeOut(host, target.actor.uid, then, clear);
    return DONE;
  }
  const actionId = request.wait ? takeActionId(host) : null;
  startFades(host, hiddenNow.map(target => target.actor.uid), { actionId, clearVariables: false, direction: "in",
    then: "keep" }, ms);
  startFades(host, shown.map(target => target.actor.uid), { actionId, clearVariables: clear, direction: "out",
    then }, ms);
  return actionId === null ? DONE : { actionId, kind: "pending" };
};

const despawn = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const { args, scope } = request;
  const targets = fieldSoldiers(host, unitTargets(host, scope, args.actor));
  if (targets.length === 0) return GONE;
  const ms = numberArg(scope, args.fadeMs, 0);
  if (ms > 0) return fadedResult(host, request, targets.map(target => target.actor.uid), ms, "out", "remove");
  for (const target of targets) controlOf(host)!.despawn(target.actor.uid);
  return DONE;
};

const killTargets = (host: ScriptActionHost, targets: readonly UnitTarget[], count: number) => {
  let killed = 0;
  for (const target of targets) {
    if (killed >= count) break;
    if (controlOf(host)?.kill(target.actor.uid)) killed += 1;
  }
  return killed;
};

const kill = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const { args, scope } = request;
  const targets = unitTargets(host, scope, args.actor);
  if (targets.length === 0) return GONE;
  const count = Math.round(numberArg(scope, args.count, targets.length));
  return killTargets(host, targets, count) > 0 ? DONE : REFUSED;
};

/** Kill N of a type: nearest to a region, the oldest (lowest uid) or the newest first. */
const killCount = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const { args, scope } = request;
  const targets = unitTargets(host, scope, args.actor);
  const order = stringArg(scope, args.order, "oldest"), region = regionOf(host, args.region);
  if (order === "newest") targets.reverse();
  if (order === "nearestTo" && region) {
    const centre = regionCentre(region);
    const distance = (target: UnitTarget) => Math.abs(target.actor.x - centre.x) + Math.abs(target.actor.z - centre.z);
    targets.sort((a, b) => distance(a) - distance(b) || a.handle.id - b.handle.id);
  }
  killTargets(host, targets, Math.round(numberArg(scope, args.count, 0)));
  return DONE;
};

const setOwner = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const faction = factionArg(request.args.owner);
  if (faction === null) return REFUSED;
  const targets = unitTargets(host, request.scope, request.args.actor);
  const changed = targets.filter(target => controlOf(host)?.setFaction(target.actor.uid, faction));
  return changed.length ? DONE : REFUSED;
};

const hide = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const { args, scope } = request;
  const hidden = booleanArg(scope, args.hidden, true);
  const targets = unitTargets(host, scope, args.actor).filter(target => hidden
    ? controlOf(host)?.isFieldSoldier(target.actor.uid) && target.actor.visible
    : isHidden(host, target.actor.uid));
  for (const target of targets) {
    if (hidden) hideUnit(host, target);
    else unhide(host, target);
  }
  return DONE;
};

const setInvulnerable = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const { args, scope } = request;
  const on = booleanArg(scope, args.on, true);
  for (const target of unitTargets(host, scope, args.actor)) setMember(host.state.invulnerable, target.actor.uid, on);
  return DONE;
};

/** A unit at the end of its fade out: hidden (optionally dropped from actor variables) or removed. */
export const finishFadeOut = (host: ScriptActionHost, uid: number, then: ScriptFade["then"], clear: boolean) => {
  if (then === "remove") {
    controlOf(host)?.despawn(uid);
    return;
  }
  const actor = host.context.actors.find(entry => entry.uid === uid);
  if (actor) hideUnit(host, { actor, handle: unitHandle(host.generations, uid) });
  if (clear) host.engine().releaseHandle(unitHandle(host.generations, uid));
};

export const PRESENCE_ACTIONS: Readonly<Record<string, (host: ScriptActionHost, request: ScriptActionRequest) =>
  Result>> = { appear, despawn, fade, hide, kill, killCount, setInvulnerable, setOwner, spawn };

/** Map start (design §4.3): `hiddenAtStart` placed members wait hidden, `spawnAtStart` spawn actors appear. */
export const startAuthoredActors = (host: ScriptActionHost) => {
  const engine = host.engine();
  for (const authored of engine.script.actors) {
    const binding = engine.state.actors[authored.id];
    if (!binding) continue;
    if (authored.binding === "placed" && authored.hiddenAtStart) {
      for (const member of binding.members) {
        const actor = host.context.actors.find(entry => entry.uid === member.handle.id);
        if (member.handle.space === "actor" && actor) hideUnit(host, { actor, handle: member.handle });
      }
      continue;
    }
    if (authored.binding !== "spawn" || !authored.spawnAtStart || authored.owner.kind !== "slot") continue;
    const region = host.members.region(authored.place.region.id);
    const spawned = region ? spawnUnits(host, { count: authored.count, faction: authored.owner.faction,
      facing: authored.place.facing, look: authored.look, region, type: authored.type }) : [];
    if (spawned.length) binding.incarnation = 1;
    binding.members.push(...spawned.map(handle => ({ handle, scripted: false, state: "alive" as const })));
  }
  engine.rebuildInstanceIndex();
};
