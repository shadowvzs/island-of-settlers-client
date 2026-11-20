import { DMath } from "../math/deterministic-math";
import { type CommanderOperationId, isCampaignOperationId } from "./commander-operation-id";
import { militaryGroundPath } from "./military-routing";
import { COMMANDER_RECOVERY_SECONDS, commanderMaximumHealth,type CommanderState } from "./settlement-commander";
import {
  COMMANDER_DECK_SLOTS, COMMANDER_RETURNING_PHASE, COMMANDER_WAITING_PHASE, type CommanderManifest, copyCommanderManifest,
  militaryActorRoute, planCommanderMuster
} from "./settlement-commander-transport";
import { exitPath } from "./settlement-entrance";
import { isOwnBuilding } from "./settlement-home";
import type { SettlementSoldier } from "./settlement-military";
import { moveActor, setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

export interface CommanderTransportHooks {
  /** Ask the island's naval service for a pickup voyage; true when a real ship is under way. */
  requestReturnShip?: (actorUid: number) => boolean;
  /** Hand a surviving commander to the return queue (a building-free adventure's anchored ship). */
  handOffReturn?: (manifest: CommanderManifest) => void;
  status: (lodge?: SettlementBuilding) => void;
}

export interface CommanderTransportHosts {
  context: SettlementContext;
  soldiers: Map<number, SettlementSoldier>;
  lodge: SettlementBuilding | undefined;
  soldier: SettlementSoldier | undefined;
  actor: SettlementActor | undefined;
}

const COMMANDER_LODGE_RETURN_PHASE = "commanderLodgeReturning";

/** The friendly lodge that currently owns the commander, if any. */
export const commanderHomeLodge = (context: SettlementContext, state: CommanderState) =>
  context.buildings.find(building => building.uid === state.homeLodgeUid &&
    building.typeId === 62 && building.construction === 1 && isOwnBuilding(building));

const friendlyHarbour = (context: SettlementContext) =>
  context.buildings.find(building => building.typeId === 39 && building.construction === 1 &&
    isOwnBuilding(building));

const claimedOperationReason = (state: CommanderState) => {
  const claimed = state.transport?.operationId ?? state.operationId;
  if (isCampaignOperationId(claimed)) return "Commander is already assigned to a campaign";
  return "Commander is already assigned to an expedition";
};

/**
 * Claim the one outward slot atomically; the caller must already own the launch validation. An expedition id and
 * a campaign run id (`campaign:<mapId>:<attempt>`) share the slot, so the commander serves one operation only.
 */
export const claimCommanderOperation = (
  state: CommanderState, hp: number, maximum: number, operationId: CommanderOperationId, destinationName: string
): { ok: true } | { ok: false; reason: string } => {
  if (state.transport || state.operationId !== undefined) return { ok: false, reason: claimedOperationReason(state) };
  if (state.location !== "lodge" || state.recoverySeconds > 0)
    return { ok: false, reason: "Commander is not resting at the Commander's Lodge" };
  if (hp <= 0 || hp < maximum * .5) return { ok: false, reason: "Commander is too injured to deploy" };
  state.operationId = operationId;
  state.destinationName = destinationName;
  state.location = "reserved";
  state.transport = { destinationName, operationId, phase: "reserved" };
  return { ok: true };
};

/** Release a claim before departure and put the commander back inside its lodge. */
export const releaseCommanderOperation = (
  actors: { actor: SettlementActor | undefined; lodge: SettlementBuilding | undefined;
    soldier: SettlementSoldier | undefined }, state: CommanderState
): boolean => {
  if (state.transport?.phase === "deployed" || state.transport?.phase === "aboard") return false;
  const { actor, lodge, soldier } = actors;
  state.operationId = undefined;
  state.destinationName = undefined;
  state.transport = undefined;
  if (!lodge || !actor) { state.location = "awaiting-home"; return true; }
  Object.assign(actor, { action: "idle", building: lodge.uid, home: lodge.uid, path: [], pathIndex: 0,
    phase: "commanderLodge", visible: false, x: lodge.doorThreshold.x, y: lodge.y, z: lodge.doorThreshold.z });
  if (soldier) soldier.building = -1;
  state.location = "lodge";
  return true;
};

/** Lodge door → open ground → exterior muster point; never a teleport through storage. */
export const musterCommander = (
  context: SettlementContext, state: CommanderState, actor: SettlementActor, soldier: SettlementSoldier,
  lodge: SettlementBuilding | undefined, harbourUid?: number
): { ok: true } | { ok: false; reason: string } => {
  if (!actor || !soldier || !lodge) return { ok: false, reason: "No commander is resting at a lodge" };
  const harbour = harbourUid === undefined ? friendlyHarbour(context)
    : context.buildings.find(building => building.uid === harbourUid && building.typeId === 39 &&
      building.construction === 1);
  const planned = planCommanderMuster(context, lodge, harbour);
  if ("reason" in planned) return { ok: false, reason: planned.reason };
  actor.visible = true;
  actor.mounted = false;
  actor.building = lodge.uid;
  actor.home = lodge.uid;
  actor.action = "walk";
  Object.assign(actor, { x: lodge.doorThreshold.x, z: lodge.doorThreshold.z, y: lodge.y });
  const start = DMath.hypot(planned.plan.start.x - lodge.access.x, planned.plan.start.z - lodge.access.z) > .01
    ? [planned.plan.start] : [];
  setActorPath(actor, [...exitPath(lodge), ...start, ...planned.plan.path], "militaryLeaving");
  soldier.building = -3;
  state.location = "muster";
  state.transport = { ...(state.transport ?? { destinationName: "Expedition",
    operationId: state.operationId ?? 1 }), phase: "muster" };
  return { ok: true };
};

/** The manifest carried into the destination world. */
export const commanderManifestOf = (state: CommanderState, hp: number): CommanderManifest => ({
  casualty: hp <= 0,
  destinationName: state.transport?.destinationName ?? state.destinationName ?? "Expedition",
  failureId: state.failureId,
  healingSeconds: state.healingSeconds,
  homeIslandSeed: state.homeIslandSeed ?? 0,
  hp: Math.max(0, hp),
  id: state.id,
  lastXpResult: state.lastXpResult,
  level: state.level,
  maximumHp: commanderMaximumHealth(state.level),
  name: state.name,
  nation: state.nation,
  definitionId: state.definitionId,
  operationId: state.transport?.operationId ?? state.operationId ?? 1,
  phase: "outward",
  recoverySeconds: state.recoverySeconds,
  xp: state.xp
});

export const detachCommanderForTransport = (state: CommanderState, hp: number) =>
  copyCommanderManifest({
    ...commanderManifestOf(state, hp),
    phase: state.transport?.phase === "returning" || state.location === "returning" ? "returning" : "outward"
  });

/** Home keeps an away tombstone; the destination drops its temporary copy on the return voyage. */
export const commanderLeavesIsland = (state: CommanderState, hp: number) => {
  const destinationCopy = state.homeLodgeUid < 0 || state.transport?.phase === "deployed";
  if (!destinationCopy) {
    state.location = "away";
    state.awayHp = hp;
    state.transport = { ...(state.transport ?? { destinationName: "Expedition", operationId: 1 }),
      phase: "deployed" };
  }
  return destinationCopy;
};

/** A destination world adopts the manifest; home adoption stabilizes/recovery once at the lodge. */
export const adoptCommanderManifest = (
  context: SettlementContext, manifest: CommanderManifest, actor: SettlementActor,
  soldier: SettlementSoldier, placement: "adventure" | "colony" | "home"
): CommanderState => {
  const lodge = context.buildings.find(building => building.typeId === 62 && building.construction === 1 &&
    isOwnBuilding(building));
  soldier.commanderId = manifest.id;
  if (placement === "home") return adoptAtHome(manifest, actor, soldier, lodge);
  if (soldier.combat) soldier.combat.hp = Math.max(0, manifest.hp);
  return {
    ...(manifest.failureId ? { failureId: manifest.failureId } : {}),
    ...(manifest.lastXpResult ? { lastXpResult: manifest.lastXpResult } : {}),
    destinationName: manifest.destinationName,
    healingSeconds: manifest.healingSeconds,
    homeIslandSeed: manifest.homeIslandSeed,
    homeLodgeUid: -1,
    id: manifest.id,
    level: manifest.level,
    location: "travelling",
    name: manifest.name,
    nation: manifest.nation,
    definitionId: manifest.definitionId,
    operationId: manifest.operationId,
    recoverySeconds: manifest.recoverySeconds,
    transport: { destinationName: manifest.destinationName, operationId: manifest.operationId, phase: "deployed" },
    xp: manifest.xp
  };
};

const adoptAtHome = (
  manifest: CommanderManifest, actor: SettlementActor | undefined, soldier: SettlementSoldier,
  lodge: SettlementBuilding | undefined
): CommanderState => {
  const recovering = manifest.casualty || Boolean(manifest.failureId);
  if (soldier.combat) soldier.combat.hp = manifest.casualty ? 1 : manifest.hp;
  let location: CommanderState["location"] = "awaiting-home";
  if (lodge) location = recovering ? "recovering" : "lodge";
  const state: CommanderState = {
    ...(manifest.failureId ? { failureId: manifest.failureId } : {}),
    ...(manifest.lastXpResult ? { lastXpResult: manifest.lastXpResult } : {}),
    awayHp: undefined,
    destinationName: undefined,
    healingSeconds: manifest.healingSeconds,
    homeIslandSeed: manifest.homeIslandSeed,
    homeLodgeUid: lodge?.uid ?? -1,
    id: manifest.id,
    level: manifest.level,
    location,
    name: manifest.name,
    nation: manifest.nation,
    definitionId: manifest.definitionId,
    operationId: undefined,
    recoverySeconds: lodge && recovering ? COMMANDER_RECOVERY_SECONDS : 0,
    transport: undefined,
    xp: manifest.xp
  };
  if (!lodge || !actor) return state;
  Object.assign(actor, { action: "idle", building: lodge.uid, home: lodge.uid, path: [], pathIndex: 0,
    phase: recovering ? "commanderRecovering" : "commanderLodge", visible: false,
    x: lodge.doorThreshold.x, y: lodge.y, z: lodge.doorThreshold.z });
  soldier.building = -1;
  return state;
};

/** The colony harbour landing: real exit from the harbour door to open field. */
export const beginColonyLanding = (
  context: SettlementContext, actor: SettlementActor, state: CommanderState
): void => {
  const harbour = friendlyHarbour(context);
  if (!harbour) { actor.phase = "militaryField"; actor.visible = true; state.location = "field"; return; }
  Object.assign(actor, { action: "walk", building: harbour.uid, home: harbour.uid, mounted: false,
    phase: "militaryLeaving", visible: true,
    x: harbour.doorThreshold.x, y: harbour.y, z: harbour.doorThreshold.z });
  setActorPath(actor, exitPath(harbour), "militaryLeaving");
};

/** A living commander's field-to-harbour return route; a casualty is handed to the transport owner. */
export const beginCommanderReturn = (
  context: SettlementContext, state: CommanderState, actor: SettlementActor | undefined,
  soldier: SettlementSoldier | undefined, hooks: CommanderTransportHooks
): { ok: true } | { ok: false; reason: string } => {
  if (!actor || !state.transport || state.transport.phase === "returning")
    return { ok: false, reason: "The commander is not deployed" };
  if (!["field", "incapacitated", "awaiting-evacuation"].includes(state.location))
    return { ok: false, reason: "The commander cannot return from its current state" };
  const harbour = friendlyHarbour(context);
  if (!harbour) {
    if (state.location === "incapacitated" || state.location === "awaiting-evacuation")
      return { ok: false, reason: "Awaiting sea evacuation: no return ship is available" };
    const route = militaryActorRoute(context, actor, context.options.world.start, true);
    if (!route) return { ok: false, reason: "No safe route to the landing beach" };
    actor.visible = true;
    actor.action = "walk";
    setActorPath(actor, route, COMMANDER_RETURNING_PHASE);
    state.location = "returning";
    state.transport.phase = "returning";
    return { ok: true };
  }
  if (state.location === "incapacitated" || state.location === "awaiting-evacuation") {
    if (!hooks.requestReturnShip?.(actor.uid))
      return { ok: false, reason: "Awaiting sea evacuation: no return ship is available" };
    stageReturnAtHarbour(state, actor, harbour);
    return { ok: true };
  }
  const route = militaryActorRoute(context, actor, harbour.access, true);
  if (!route) {
    if (DMath.hypot(actor.x - harbour.access.x, actor.z - harbour.access.z) > 10)
      return { ok: false, reason: "No mounted-safe route to the harbour" };
    // Already at the harbour landing: enter the harbour passage for the pickup, not a field march.
    stageReturnAtHarbour(state, actor, harbour);
    if (soldier) soldier.building = -1;
    hooks.requestReturnShip?.(actor.uid);
    return { ok: true };
  }
  actor.visible = true;
  actor.mounted = true;
  actor.action = "walk";
  setActorPath(actor, route, COMMANDER_RETURNING_PHASE);
  state.location = "returning";
  state.transport.phase = "returning";
  return { ok: true };
};

const stageReturnAtHarbour = (
  state: CommanderState, actor: SettlementActor, harbour: SettlementBuilding
): void => {
  Object.assign(actor, { action: "idle", building: harbour.uid, home: harbour.uid, path: [], pathIndex: 0,
    phase: "militaryReserve", visible: false, x: harbour.doorThreshold.x, y: harbour.y, z: harbour.doorThreshold.z });
  state.location = "returning";
  state.transport = { ...(state.transport ?? { destinationName: "Expedition", operationId: 1 }),
    phase: "returning" };
};

const handOffAdventureReturn = (
  context: SettlementContext, state: CommanderState, actor: SettlementActor, soldier: SettlementSoldier,
  hooks: CommanderTransportHooks
) => {
  hooks.handOffReturn?.(copyCommanderManifest({
    ...commanderManifestOf(state, soldier.combat?.hp ?? 0), phase: "returning"
  }));
  soldier.combat = undefined;
  context.actors.splice(context.actors.indexOf(actor), 1);
};

/** One return/evacuation/landing tick; called from the commander system update. */
export const updateCommanderTransport = (
  host: CommanderTransportHosts, state: CommanderState, dt: number, hooks: CommanderTransportHooks
): void => {
  const { actor, context, soldier } = host;
  if (!actor || !soldier) return;
  if (state.location === "muster" && ["militaryLeaving", "militaryField"].includes(actor.phase) &&
    actor.path.length === 0) {
    actor.phase = COMMANDER_WAITING_PHASE;
    actor.action = "idle";
    actor.mounted = false;
    actor.path = [];
    actor.pathIndex = 0;
    state.location = "waiting";
    state.transport = { ...(state.transport ?? { destinationName: "Expedition", operationId: 1 }),
      phase: "waiting" };
    return;
  }
  if (state.location === "muster" && actor.phase === "militaryLeaving") {
    if (!moveActor(context, actor, dt)) return;
    actor.phase = COMMANDER_WAITING_PHASE;
    actor.action = "idle";
    actor.mounted = false;
    actor.path = [];
    actor.pathIndex = 0;
    state.location = "waiting";
    state.transport = { ...(state.transport ?? { destinationName: "Expedition", operationId: 1 }),
      phase: "waiting" };
    return;
  }
  if (state.location === "travelling" && state.transport?.phase === "deployed" &&
    actor.phase === "militaryLeaving") {
    if (moveActor(context, actor, dt)) {
      actor.action = "idle";
      actor.path = [];
      actor.pathIndex = 0;
      state.location = "field";
    }
    return;
  }
  if (actor.phase === COMMANDER_LODGE_RETURN_PHASE) {
    if (!moveActor(context, actor, dt)) return;
    releaseCommanderOperation({ actor, lodge: host.lodge, soldier }, state);
    return;
  }
  if (actor.phase === COMMANDER_RETURNING_PHASE) {
    if (!moveActor(context, actor, dt)) return;
    const harbour = friendlyHarbour(context);
    if (!harbour) {
      handOffAdventureReturn(context, state, actor, soldier, hooks);
      return;
    }
    stageReturnAtHarbour(state, actor, harbour);
    soldier.building = -1;
    hooks.requestReturnShip?.(actor.uid);
    return;
  }
  if (state.location === "returning" && actor.phase === "militaryReserve") {
    hooks.requestReturnShip?.(actor.uid);
    return;
  }
  if (state.location === "awaiting-evacuation" &&
    (actor.phase === "commanderIncapacitated" || actor.phase === "militaryReserve")) {
    const harbour = friendlyHarbour(context);
    if (!harbour) return;
    if (actor.phase === "commanderIncapacitated") {
      Object.assign(actor, { action: "idle", building: harbour.uid, home: harbour.uid, path: [], pathIndex: 0,
        phase: "militaryReserve", visible: false, x: harbour.doorThreshold.x, y: harbour.y,
        z: harbour.doorThreshold.z });
      soldier.building = -1;
    }
    if (hooks.requestReturnShip?.(actor.uid)) {
      state.location = "returning";
      state.transport = { ...(state.transport ?? { destinationName: "Expedition", operationId: 1 }),
        phase: "returning" };
    }
    return;
  }
  if (state.location === "travelling" &&
    ["militaryField", "militaryLeaving", "militarySiege"].includes(actor.phase)) state.location = "field";
};

export const commanderTransportDeckSlots = COMMANDER_DECK_SLOTS;

/** Recovery/transport eligibility used by the UI before any request is made. */
export const commanderReturnReady = (state: CommanderState) =>
  state.transport?.phase === "deployed" &&
  ["field", "incapacitated", "awaiting-evacuation"].includes(state.location);

/** Send a mustering/preparing commander back to its lodge after a cancelled preparation. */
export const recallCommanderToLodge = (
  context: SettlementContext, state: CommanderState, actor: SettlementActor | undefined,
  lodge: SettlementBuilding | undefined
): boolean => {
  if (!actor || !lodge) return false;
  const path = militaryGroundPath(context, actor, lodge.access, false);
  if (!path) return false;
  actor.visible = true;
  actor.action = "walk";
  setActorPath(actor, path, COMMANDER_LODGE_RETURN_PHASE);
  state.location = "returning";
  state.transport = { ...(state.transport ?? { destinationName: "Expedition",
    operationId: state.operationId ?? 1 }), phase: "returning" };
  return true;
};


export { advanceCommanderBoarding, type CommanderBoardingShip } from "./settlement-commander-boarding";
