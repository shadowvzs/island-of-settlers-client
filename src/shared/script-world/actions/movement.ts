import {
  autoDurationMs, pageSpeakText
} from "../../../../../island-of-settlers-shared/src/campaign/cinematics/speak-timing";
import type {
  ScriptActionRequest, ScriptActionResult
} from "../../../../../island-of-settlers-shared/src/script/engine/ports";
import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { ActionOutcome } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import { DMath } from "../../math/deterministic-math";
import type { SettlementActor } from "../../settlement/settlement-types";
import { findUnit } from "../script-actors";
import {
  finishRecord, isPlaceClear, numberArg, refIdArg, regionCentre, regionFacing, regionOf, regionPlaces,
  type ScriptActionHost, scriptTickOf, stringArg, takeActionId, ticksOfMs, type UnitTarget, unitTargets, valueArg
} from "./action-host";
import type { ScriptUnitAction } from "./action-state";
import {
  ARRIVAL_RADIUS, DEFAULT_SPYGLASS_SECONDS, DEGREES_TO_RADIANS, SCRIPT_CLIP_SECONDS, SPYGLASS_CLIP, SPYGLASS_TOOL
} from "./constants";

/**
 * Movement actions (trigger design §5.2.2, TRG5a): move to a region with a stance, teleport, face, release, speak,
 * play a clip and look through the spyglass. A move, clip or look is a story-controlled unit action: it holds the
 * unit's lock (§6.6) until its outcome or `release`. Moves and teleports handle soldiers in the open field; facing,
 * clips, spyglass looks and speech work for every unit.
 */

type Result = ScriptActionResult;

const REFUSED: Result = { kind: "failed", outcome: "refused" };
const GONE: Result = { kind: "failed", outcome: "actorGone" };
const DONE: Result = { kind: "done" };

const controlOf = (host: ScriptActionHost) => host.context.military?.scriptUnits;

/** A new story action of a unit replaces the one it had (which ends `interrupted`). */
const replaceUnitAction = (host: ScriptActionHost, uid: number) => {
  const previous = host.state.units.find(record => record.actor === uid);
  if (previous) finishRecord(host, host.state.units, previous, "interrupted");
};

const startUnitActions = (host: ScriptActionHost, request: ScriptActionRequest, targets: readonly UnitTarget[],
  fields: Omit<ScriptUnitAction, "actionId" | "actor" | "deadline" | "generation" | "overridable">): Result => {
  const actionId = request.wait ? takeActionId(host) : null;
  for (const { actor, handle } of targets) {
    replaceUnitAction(host, actor.uid);
    host.state.units.push({ ...fields, actionId, actor: actor.uid, deadline: request.deadlineScriptTick,
      generation: handle.generation, overridable: request.overridable });
  }
  return actionId === null ? DONE : { actionId, kind: "pending" };
};

/** The first clear place of the region for a unit (guaranteed mode searches around it as well). */
const placeFor = (host: ScriptActionHost, regionId: string, uid: number) => {
  const region = host.members.region(regionId);
  return region && regionPlaces(host, region).find(place => isPlaceClear(host.context, place, uid));
};

const teleportInto = (host: ScriptActionHost, uid: number, regionId: string, facing?: number) => {
  const place = placeFor(host, regionId, uid);
  const region = host.members.region(regionId);
  if (!place || !region) return false;
  const actor = findUnit(host.context, uid);
  return controlOf(host)?.teleport(uid, place, facing ?? regionFacing(region) ?? actor?.yaw ?? 0) ?? false;
};

const fieldTargets = (host: ScriptActionHost, request: ScriptActionRequest) =>
  unitTargets(host, request.scope, request.args.actor).filter(target =>
    controlOf(host)?.isFieldSoldier(target.actor.uid));

const factionOf = (host: ScriptActionHost, uid: number) => host.context.military?.factionOf?.(uid) ?? 0;

const move = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const region = regionOf(host, request.args.region), control = controlOf(host);
  const targets = fieldTargets(host, request);
  if (!region || !control) return REFUSED;
  if (targets.length === 0) return GONE;
  const mode = stringArg(request.scope, request.args.stance, "defend") === "passive" ? "move" : "attackMove";
  const centre = regionCentre(region), accepted = new Set<number>();
  for (const faction of new Set(targets.map(target => factionOf(host, target.actor.uid)))) {
    const ids = targets.filter(target => factionOf(host, target.actor.uid) === faction).map(target => target.actor.uid);
    for (const uid of control.march(ids, centre, faction, mode)) accepted.add(uid);
  }
  if (host.guaranteed()) {
    for (const target of targets) if (!accepted.has(target.actor.uid)) teleportInto(host, target.actor.uid, region.id);
  }
  const moving = targets.filter(target => accepted.has(target.actor.uid));
  if (moving.length === 0) return host.guaranteed() ? DONE : { kind: "failed", outcome: "unreachable" };
  return startUnitActions(host, request, moving, { kind: "move", region: region.id, target: centre });
};

const teleport = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const regionId = refIdArg(request.args.region);
  const targets = fieldTargets(host, request);
  if (regionId === undefined) return REFUSED;
  if (targets.length === 0) return GONE;
  const facing = request.args.facing ? numberArg(request.scope, request.args.facing, 0) * DEGREES_TO_RADIANS
    : undefined;
  let moved = 0;
  for (const target of targets) {
    replaceUnitAction(host, target.actor.uid);
    if (teleportInto(host, target.actor.uid, regionId, facing)) moved += 1;
  }
  return moved > 0 ? DONE : { kind: "failed", outcome: "blocked" };
};

/** Yaw towards a live target (sim yaw convention: atan2(dx, dz)), else the authored angle. */
const yawFor = (host: ScriptActionHost, request: ScriptActionRequest, actor: SettlementActor, degrees: number) => {
  const target = request.args.target ? unitTargets(host, request.scope, request.args.target)[0] : undefined;
  if (target) return DMath.atan2(target.actor.x - actor.x, target.actor.z - actor.z);
  return degrees * DEGREES_TO_RADIANS;
};

const face = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const targets = unitTargets(host, request.scope, request.args.actor);
  if (targets.length === 0) return GONE;
  const degrees = numberArg(request.scope, request.args.angle, 0);
  for (const { actor } of targets) actor.yaw = yawFor(host, request, actor, degrees);
  return DONE;
};

/** Ends the units' story actions (`interrupted`): the player and the AI may order them again. */
const release = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  for (const target of unitTargets(host, request.scope, request.args.actor)) replaceUnitAction(host, target.actor.uid);
  return DONE;
};

const playClip = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const clip = stringArg(request.scope, request.args.clip, "");
  const seconds = SCRIPT_CLIP_SECONDS[clip];
  const targets = unitTargets(host, request.scope, request.args.actor);
  if (seconds === undefined) return REFUSED;
  if (targets.length === 0) return GONE;
  const loops = Math.max(1, Math.round(numberArg(request.scope, request.args.loops, 1)));
  const endTick = scriptTickOf(host) + Math.max(1, ticksOfMs(seconds * loops * 1000));
  return startUnitActions(host, request, targets, { clip, endTick, kind: "clip" });
};

/** A settler with a spyglass looks towards a direction or a live actor for `seconds` (owner 16). */
const lookSpyglass = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const targets = unitTargets(host, request.scope, request.args.actor);
  const scouts = targets.filter(target => target.actor.tool === SPYGLASS_TOOL);
  if (targets.length === 0) return GONE;
  if (scouts.length === 0) return REFUSED;
  const degrees = numberArg(request.scope, request.args.yawDeg, 0);
  for (const { actor } of scouts) actor.yaw = yawFor(host, request, actor, degrees);
  const seconds = numberArg(request.scope, request.args.seconds, DEFAULT_SPYGLASS_SECONDS);
  const endTick = scriptTickOf(host) + Math.max(1, ticksOfMs(seconds * 1000));
  return startUnitActions(host, request, scouts, { clip: SPYGLASS_CLIP, endTick, kind: "clip",
    pitch: numberArg(request.scope, request.args.pitchDeg, 0) });
};

/** Line length from the English source, so every client times it alike (design §12: the sim never localizes). */
const speakTicks = (text: QuestText) =>
  Math.max(1, ticksOfMs(pageSpeakText(text.en).reduce((total, page) => total + autoDurationMs(page), 0)));

const speak = (host: ScriptActionHost, request: ScriptActionRequest): Result => {
  const text = valueArg(request.scope, request.args.text) as QuestText | null;
  if (!text || typeof text.en !== "string") return REFUSED;
  const speaker = unitTargets(host, request.scope, request.args.actor)[0];
  const actionId = request.wait ? takeActionId(host) : null;
  const startTick = scriptTickOf(host);
  host.state.speech.push({ actionId, endTick: startTick + speakTicks(text), startTick, text,
    ...(speaker ? { actor: speaker.actor.uid } : {}),
    ...(refIdArg(request.args.speaker) ? { speaker: refIdArg(request.args.speaker) } : {}) });
  return actionId === null ? DONE : { actionId, kind: "pending" };
};

export const MOVEMENT_ACTIONS: Readonly<Record<string, (host: ScriptActionHost, request: ScriptActionRequest) =>
  Result>> = { face, lookSpyglass, move, playClip, release, speak, teleport };

/** A finished march: arrived when it stands in the region or near its centre, else unreachable. */
const arrivalOutcome = (host: ScriptActionHost, record: ScriptUnitAction, actor: SettlementActor): ActionOutcome => {
  const inside = record.region !== undefined && host.members.inRegion(record.region,
    { contained: !actor.visible, x: actor.x, z: actor.z });
  const target = record.target!;
  if (inside || DMath.hypot(actor.x - target.x, actor.z - target.z) <= ARRIVAL_RADIUS) return "done";
  if (host.guaranteed() && teleportInto(host, actor.uid, record.region!)) return "done";
  return "unreachable";
};

const moveOutcome = (host: ScriptActionHost, record: ScriptUnitAction, actor: SettlementActor, tick: number) => {
  const marching = controlOf(host)?.isMarching(actor.uid) ?? false;
  if (!marching) return arrivalOutcome(host, record, actor);
  const due = record.deadline !== null && tick + 1 >= record.deadline;
  if (host.guaranteed() && due && teleportInto(host, actor.uid, record.region!)) return "done";
  return null;
};

/** Each live tick: story unit actions end on arrival, at their clip end or when the unit is gone. */
export const updateUnitActions = (host: ScriptActionHost) => {
  const tick = scriptTickOf(host);
  for (const record of [...host.state.units]) {
    const actor = findUnit(host.context, record.actor);
    const live = actor && (host.generations.get(record.actor) ?? 0) === record.generation;
    let outcome: ActionOutcome | null = null;
    if (!live) outcome = "actorGone";
    else if (record.kind === "clip") outcome = tick >= record.endTick! ? "done" : null;
    else outcome = moveOutcome(host, record, actor, tick);
    if (outcome) finishRecord(host, host.state.units, record, outcome);
  }
  for (const line of [...host.state.speech]) {
    if (tick >= line.endTick) finishRecord(host, host.state.speech, line, "done");
  }
};
