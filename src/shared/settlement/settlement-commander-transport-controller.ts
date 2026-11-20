import { campaignOperationId, type CommanderOperationId } from "./commander-operation-id";
import { commanderMaximumHealth, type CommanderSnapshot, type CommanderState } from "./settlement-commander";
import { advanceCommanderBoarding, type CommanderBoardingShip } from "./settlement-commander-boarding";
import { COMMANDER_DECK_SLOTS, type CommanderManifest } from "./settlement-commander-transport";
import { adoptCommanderManifest, beginColonyLanding, beginCommanderReturn, claimCommanderOperation,
  commanderLeavesIsland, commanderReturnReady,   type CommanderTransportHooks, type CommanderTransportHosts,detachCommanderForTransport, musterCommander,
  recallCommanderToLodge, releaseCommanderOperation, updateCommanderTransport } from "./settlement-commander-transport-state";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

export interface CommanderTransportControllerDeps {
  context: SettlementContext;
  soldiers: Map<number, SettlementSoldier>;
  getState: () => CommanderState | undefined;
  setState: (state: CommanderState | undefined) => void;
  lodgeOf: () => SettlementBuilding | undefined;
  soldierOf: () => SettlementSoldier | undefined;
  actorOf: () => SettlementActor | undefined;
  snapshotOf: (state: CommanderState, lodge: SettlementBuilding | undefined) => CommanderSnapshot;
  setStatus: (lodge?: SettlementBuilding) => void;
  awardExperience: (resultId: string) => boolean;
}

/**
 * The lodge-side outward/return transport controls. Kept outside the commander system's own
 * closure so the public system stays a small orchestration surface.
 */
export const createCommanderTransportController = (deps: CommanderTransportControllerDeps) => {
  const { actorOf, awardExperience, context, getState, lodgeOf, setState, setStatus, snapshotOf, soldierOf } = deps;
  let requestReturnShip: ((actorUid: number) => boolean) | undefined;
  let handOffReturn: ((manifest: CommanderManifest) => void) | undefined;
  const hooks = (): CommanderTransportHooks => ({ handOffReturn, requestReturnShip, status: setStatus });
  const host = (): CommanderTransportHosts => ({
    actor: actorOf(), context, lodge: lodgeOf(), soldier: soldierOf(), soldiers: deps.soldiers
  });

  const claimOperation = (operationId: CommanderOperationId, destinationName: string) => {
    const active = context.commanderControl?.snapshot();
    if (active) return { ok: false as const, reason: "Leave direct control before assigning an expedition" };
    const state = getState();
    if (!state) return { ok: false as const, reason: "No commander is available at home" };
    const maximum = commanderMaximumHealth(state.level);
    const claim = claimCommanderOperation(state, state.awayHp ?? deps.soldierOf()?.combat?.hp ?? 0,
      maximum, operationId, destinationName);
    if (!claim.ok) return claim;
    setStatus(lodgeOf());
    return { ok: true as const, id: state.id };
  };

  const releaseOperation = () => {
    const state = getState();
    if (!state) return false;
    const released = releaseCommanderOperation({ actor: actorOf(), lodge: lodgeOf(), soldier: soldierOf() }, state);
    setStatus(lodgeOf());
    return released;
  };

  /** A colony or adventure expedition claims the slot under its expedition id. */
  const claimForExpedition = (expeditionId: number, destinationName: string) =>
    claimOperation(expeditionId, destinationName);
  /** A campaign run claims the same slot under `campaign:<mapId>:<attempt>`, so neither side can double-book. */
  const claimForCampaign = (mapId: string, attempt: number, destinationName: string) =>
    claimOperation(campaignOperationId(mapId, attempt), destinationName);

  const muster = (operationId: CommanderOperationId, harbourUid?: number) => {
    const state = getState();
    if (!state) return { ok: false as const, reason: "No commander is assigned" };
    if (state.transport?.operationId !== operationId)
      return { ok: false as const, reason: "Commander operation does not match" };
    const actor = actorOf(), soldier = soldierOf();
    if (!actor || !soldier) return { ok: false as const, reason: "Commander actor is unavailable" };
    const result = musterCommander(context, state, actor, soldier, lodgeOf(), harbourUid);
    setStatus(lodgeOf());
    return result;
  };

  const recallToLodge = () => {
    const state = getState();
    if (!state) return false;
    const recalled = recallCommanderToLodge(context, state, actorOf(), lodgeOf());
    if (!recalled) releaseOperation();
    setStatus(lodgeOf());
    return true;
  };

  const advanceBoarding = (ship: CommanderBoardingShip, dt: number) => {
    const state = getState();
    if (!state) return true;
    return advanceCommanderBoarding(context, state, actorOf(), soldierOf(), ship, dt);
  };

  const detachForTransport = (): CommanderManifest | null => {
    const state = getState();
    if (!state) return null;
    const soldier = soldierOf();
    const manifest = detachCommanderForTransport(state, soldier?.combat?.hp ?? state.awayHp ?? 0);
    if (commanderLeavesIsland(state, soldier?.combat?.hp ?? 0)) setState(undefined);
    setStatus(lodgeOf());
    return manifest;
  };

  const adopt = (manifest: CommanderManifest, actor: SettlementActor, placement: "adventure" | "colony" | "home") => {
    const soldier = deps.soldiers.get(actor.uid);
    if (!soldier) return false;
    const state = adoptCommanderManifest(context, manifest, actor, soldier, placement);
    if (placement === "colony") {
      soldier.building = -3;
      beginColonyLanding(context, actor, state);
    }
    if (placement === "home") context.options.commanderOwner?.claim(state.id, context.options.world.seed);
    setState(state);
    setStatus(lodgeOf());
    return true;
  };

  const transportStatus = () => {
    const state = getState();
    if (!state) return undefined;
    const snapshot = snapshotOf(state, lodgeOf());
    return {
      blockDetail: snapshot.blockDetail, blockReason: snapshot.blockReason,
      canReturn: commanderReturnReady(state), deckSlots: COMMANDER_DECK_SLOTS,
      destinationName: state.transport?.destinationName ?? state.destinationName,
      hp: snapshot.hp, id: state.id, level: state.level, location: state.location,
      maximumHp: snapshot.maximumHp, name: state.name,
      operationId: state.transport?.operationId ?? state.operationId,
      phase: state.transport?.phase, ready: snapshot.ready, xp: state.xp
    };
  };

  const beginReturn = () => {
    const state = getState();
    if (!state) return { ok: false as const, reason: "No commander is deployed" };
    const result = beginCommanderReturn(context, state, actorOf(), soldierOf(), hooks());
    setStatus(lodgeOf());
    return result;
  };

  const recordMissionFailure = (failureId: string) => {
    const state = getState();
    if (!state || !failureId || failureId.length > 160 || state.failureId === failureId) return false;
    if (!state.transport || state.transport.phase !== "deployed") return false;
    state.failureId = failureId;
    return true;
  };

  const updateTransport = (dt: number) => {
    const state = getState();
    if (!state || !Number.isFinite(dt) || dt <= 0) return;
    updateCommanderTransport(host(), state, dt, hooks());
  };

  return {
    adopt, advanceBoarding, attachReturnShip: (request: (actorUid: number) => boolean,
      handOff?: (manifest: CommanderManifest) => void) => { requestReturnShip = request; handOffReturn = handOff; },
    beginReturn, claimForCampaign, claimForExpedition, detachForTransport, isCommanderActor: (uid: number) => {
      const soldier = deps.soldiers.get(uid), state = getState();
      return Boolean(soldier?.commanderId && state && soldier.commanderId === state.id);
    },
    muster, recallToLodge, recordMissionFailure, releaseOperation, transportStatus, updateTransport,
    awardExperience
  };
};
