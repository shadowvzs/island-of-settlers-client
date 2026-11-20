import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { deterministicPow,DMath } from "../math/deterministic-math";
import { COMMANDER_LODGE_TYPE_ID } from "./building-type-ids";
import { deployCommanderToField } from "./commander-field-deployment";
import { commanderRecoveryProblem, recoverCommander } from "./commander-recovery";
import { payMilitaryCost } from "./military-economy";
import { militaryGroundPath } from "./military-routing";
import { STORAGE_IDS } from "./production-rules";
import {
  canDeployCommander, COMMANDER_HEAL_SECONDS, COMMANDER_LEVEL_DAMAGE_FACTOR,
  COMMANDER_MAX_LEVEL, COMMANDER_RECOVERY_SECONDS, COMMANDER_XP_THRESHOLDS,
  type CommanderBlockReason, commanderBlockReason, type CommanderDefinition, commanderDefinition, 
  commanderLevelForXp, commanderMaximumHealth, commanderName, commanderNextThreshold,   commanderRecruitCatalog,
type CommanderSave, type CommanderSnapshot, type CommanderState,
  copyCommanderState, isCommanderState
} from "./settlement-commander";
import { commanderRecruitAvailability, commanderRecruitSource } from "./settlement-commander-recruitment";
import { COMMANDER_DECK_SLOTS, commanderTransportReason } from "./settlement-commander-transport";
import { createCommanderTransportController } from "./settlement-commander-transport-controller";
import { commanderReturnReady } from "./settlement-commander-transport-state";
import { isOwnBuilding } from "./settlement-home";
import type { SettlementSoldier } from "./settlement-military";
import { createActor, moveActor, setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { rulesOf } from "./sim-rules";

/** What combat asks the commander system at its resolved-impact milestone. */
export interface CommanderHitContext {
  attacker: SettlementSoldier;
  defender: SettlementSoldier;
  ranged: boolean;
  random: () => number;
}
export interface CommanderHitModifiers {
  damageFactor: number;
  dodge: boolean;
}

const commanderSoldierOf = (soldiers: ReadonlyMap<number, SettlementSoldier>, state: CommanderState | undefined) =>
  state ? [...soldiers.values()].find(soldier => soldier.commanderId === state.id) : undefined;
const friendly = (soldier: SettlementSoldier | undefined) => (soldier?.combat?.faction ?? 1) === 0;

/** Keeps the roster identity safe when its lodge is demolished; its home becomes unavailable. */
const detachCommanderFromLodge = (
  context: SettlementContext, state: CommanderState, soldier: SettlementSoldier | undefined,
  actor: SettlementActor | undefined
) => {
  const storage = context.buildings.find(building => building.construction === 1 &&
    isOwnBuilding(building) && STORAGE_IDS.has(building.typeId));
  const inside = actor?.phase === "commanderLodge" || actor?.phase === "commanderRecovering";
  if (inside && soldier) { soldier.building = -1; soldier.stationed = false; }
  const recovering = state.location === "recovering";
  if (actor && inside) {
    actor.phase = recovering ? "commanderRecovering" : "commanderLodge";
    actor.visible = false; actor.path = []; actor.pathIndex = 0;
  }
  if (actor?.home === state.homeLodgeUid) actor.home = storage?.uid ?? -1;
  if (actor?.building === state.homeLodgeUid) actor.building = storage?.uid ?? -1;
  const mount = context.actors.find(entry => entry.uid === soldier?.combat?.mount);
  if (mount?.home === state.homeLodgeUid) mount.home = storage?.uid ?? -1;
  if (mount?.building === state.homeLodgeUid) mount.building = storage?.uid ?? -1;
  // A recovering commander keeps recovering once rehomed (adoptRebuiltLodge).
  if (inside && !recovering) state.location = "lodge";
  // No cooldown credit is invented; missing home pauses recovery and healing.
};

/** One hidden horse actor owned by the commander; never a civilian ware or traffic animal. */
const createCommanderMount = (context: SettlementContext, lodge: SettlementBuilding) => {
  const uid = context.nextActor++;
  const mount: SettlementActor = {
    action: "idle", animationTime: 0, building: lodge.uid, home: lodge.uid, job: "Mount",
    path: [], pathIndex: 0, phase: "horseMounted", timer: 0, tool: undefined, uid,
    visible: false, ware: null, x: lodge.doorThreshold.x, y: lodge.y, yaw: 0, z: lodge.doorThreshold.z
  };
  context.actors.push(mount);
  return uid;
};

/** A preparing claim cannot survive its home: clearing it lets the expedition cancel explicitly. */
const clearCommanderClaim = (state: CommanderState) => {
  if (!state.transport || state.transport.phase === "deployed" || state.transport.phase === "aboard") return;
  state.transport = undefined;
  state.operationId = undefined;
  state.destinationName = undefined;
};

const recruitedCommanderState = (id: string, nation: WorkerNation, seed: number, lodgeUid: number,
  definitionId: string): CommanderState => ({
  failureId: undefined, healingSeconds: 0, homeIslandSeed: seed, homeLodgeUid: lodgeUid, id,
  lastXpResult: undefined, level: 1, location: "lodge", name: commanderName(nation, seed), nation,
  definitionId, recoverySeconds: 0, xp: 0
});
const recruitedCommanderSoldier = (actor: number, id: string, mount: number,
  definition: CommanderDefinition): SettlementSoldier => ({
  actor, building: -1, commanderId: id, combat: { cooldown: 0, commanderLoadout: definition.loadout,
    faction: 0, hp: commanderMaximumHealth(1), mount, type: "cavalry" }, rank: 0, stationed: false
});

/**
 * The lodge/roster/readiness service. One instance owns the island's single commander; the mounted
 * soldier in the military roster is its only battlefield representation.
 */
export const createCommanderSystem = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>
) => {
  let state: CommanderState | undefined;
  const lodgeOf = (uid = state?.homeLodgeUid) => context.buildings.find(building =>
    building.uid === uid && building.typeId === COMMANDER_LODGE_TYPE_ID && building.construction === 1 &&
    isOwnBuilding(building));
  const actorOf = (soldier = commanderSoldierOf(soldiers, state)) =>
    soldier ? context.actors.find(actor => actor.uid === soldier.actor) : undefined;
  const insideLodge = (actor: SettlementActor | undefined, lodge: SettlementBuilding | undefined) =>
    Boolean(lodge && actor && !actor.visible && actor.building === lodge.uid &&
      ["commanderLodge", "commanderRecovering"].includes(actor.phase));

  const setStatus = (lodge: SettlementBuilding | undefined) => {
    if (!lodge) return;
    if (!state) { lodge.status = "Ready to recruit"; return; }
    if (state.location === "awaiting-evacuation" || state.location === "awaiting-home") {
      lodge.status = state.location === "awaiting-evacuation"
        ? "Commander awaiting evacuation" : "Commander awaiting home"; return;
    }
    if (["away", "aboard", "returning"].includes(state.location)) {
      lodge.status = "Commander assigned to an expedition"; return;
    }
    if (["assigned", "muster", "reserved", "waiting"].includes(state.location)) {
      lodge.status = "Commander mustering at the harbour"; return;
    }
    if (state.location === "incapacitated" || state.location === "travelling") {
      lodge.status = "Commander awaiting evacuation"; return;
    }
    if (state.location === "recovering") { lodge.status = "Commander recovering"; return; }
    if (state.location === "field") { lodge.status = "Commander assigned to an expedition"; return; }
    lodge.status = "Resting";
  };

  /** Stabilizes once at 1 HP and starts the concurrent 30-minute/1%-heal recovery cycle. */
  const stabilize = (soldier: SettlementSoldier, actor: SettlementActor, lodge: SettlementBuilding) => {
    if (!state) return;
    soldier.combat!.hp = 1;
    soldier.building = -1;
    actor.visible = false;
    actor.phase = "commanderRecovering";
    actor.building = lodge.uid;
    actor.home = lodge.uid;
    actor.path = [];
    actor.pathIndex = 0;
    actor.action = "idle";
    state.location = "recovering";
    state.recoverySeconds = COMMANDER_RECOVERY_SECONDS;
    delete state.failureId;
  };

  /** Real local ground evacuation; the commander walks from the casualty point to its lodge. */
  const beginEvacuation = (soldier: SettlementSoldier, actor: SettlementActor) => {
    if (!state) return;
    const lodge = lodgeOf();
    if (!lodge) { state.location = "incapacitated"; return; }
    const path = militaryGroundPath(context, actor, lodge.access, false);
    if (!path?.length) { state.location = "incapacitated"; return; }
    actor.visible = true;
    actor.phase = "commanderEvacuating";
    actor.mounted = false;
    actor.action = "walk";
    setActorPath(actor, [...path, lodge.access], "commanderEvacuating");
    state.location = "travelling";
    soldier.building = -3;
  };

  const incapacitate = (soldier: SettlementSoldier) => {
    if (!state || soldier.commanderId !== state.id) return false;
    const combat = soldier.combat;
    const actor = actorOf(soldier);
    if (!combat || !actor) return false;
    combat.hp = 0;
    combat.target = undefined;
    combat.pendingTarget = undefined;
    combat.pendingAim = undefined;
    combat.siege = undefined;
    combat.cooldown = 0;
    combat.attackTime = 0;
    if (combat.mount !== undefined) {
      const mount = context.actors.find(entry => entry.uid === combat.mount);
      if (mount) mount.visible = false;
    }
    state.location = "incapacitated";
    actor.visible = false;
    actor.mounted = false;
    actor.phase = "commanderIncapacitated";
    actor.action = "idle";
    if (lodgeOf()) beginEvacuation(soldier, actor);
    else {
      // No friendly lodge on this island (colony/adventure): a durable sea-evacuation record.
      state.location = "awaiting-evacuation";
      state.transport = { ...(state.transport ?? { destinationName: "Expedition",
        operationId: state.operationId ?? 1 }), phase: "awaiting-evacuation" };
      state.awayHp = 0;
    }
    return true;
  };

  const recruit = (lodgeUid: number, definitionId?: string): { ok: true; id: string } | { ok: false; reason: string } => {
    const lodge = lodgeOf(lodgeUid);
    if (!lodge) return { ok: false, reason: "A completed Commander's Lodge is required" };
    if (state) return { ok: false, reason: "A commander already serves this island" };
    const definition = commanderRecruitCatalog(context.playerNation ?? "roman")
      .find(entry => definitionId === undefined || entry.id === definitionId);
    if (!definition) return { ok: false, reason: "Commander type is unavailable" };
    const cost = definition.recruitCost;
    const seed = context.options.world.seed;
    const id = `commander-${seed}-${context.nextActor}`;
    const owner = context.options.commanderOwner?.get();
    if (owner && owner.homeIslandSeed !== seed)
      return { ok: false, reason: "Another island already has your commander" };
    if (owner && owner.id !== id)
      return { ok: false, reason: "A commander already serves this player" };
    const source = commanderRecruitSource(context, lodge, cost);
    if (!source) return { ok: false, reason: "Connect a storehouse holding the recruit cost and an idle settler" };
    if (context.options.commanderOwner && !context.options.commanderOwner.claim(id, seed))
      return { ok: false, reason: "A commander already serves this player" };
    if (!payMilitaryCost(source.inventory, cost)) return { ok: false, reason: "Missing recruit goods" };
    const actor = createActor(context, "Soldier", source.uid);
    const nation = context.playerNation as WorkerNation;
    const mount = createCommanderMount(context, lodge);
    Object.assign(actor, { building: lodge.uid, home: lodge.uid, tool: definition.loadout, phase: "commanderLodge",
      visible: false, x: lodge.doorThreshold.x, z: lodge.doorThreshold.z, y: lodge.y, path: [], pathIndex: 0 });
    state = recruitedCommanderState(id, nation, seed, lodge.uid, definition.id);
    soldiers.set(actor.uid, recruitedCommanderSoldier(actor.uid, id, mount, definition));
    setStatus(lodge);
    return { ok: true, id };
  };

  const awardExperience = (resultId: string) => {
    if (!state || !resultId || resultId.length > 160) return false;
    // Experience switched off (plan §9.2): a mission result earns the commander nothing.
    if (!rulesOf(context).experience) return false;
    if (state.lastXpResult === resultId) return false;
    // Only an actually deployed commander participates; previews, reservations and lodge-only states do not.
    if (!["field", "incapacitated", "awaiting-evacuation", "returning"].includes(state.location)) return false;
    const soldier = commanderSoldierOf(soldiers, state);
    if (!soldier || !actorOf(soldier)) return false;
    const previousLevel = state.level;
    state.xp = Math.min(COMMANDER_XP_THRESHOLDS[COMMANDER_MAX_LEVEL - 1]!, state.xp + 1);
    state.level = commanderLevelForXp(state.xp);
    if (state.level !== previousLevel) {
      const previousMaximum = commanderMaximumHealth(previousLevel);
      const nextMaximum = commanderMaximumHealth(state.level);
      if (soldier.combat) soldier.combat.hp = Math.max(0, Math.min(nextMaximum,
        nextMaximum * soldier.combat.hp / previousMaximum));
    }
    state.lastXpResult = resultId;
    return true;
  };

  /** The assigned lodge is being removed: keep the roster identity in a safe interior and await a home. */
  const beforeBuildingRemoved = (uid: number) => {
    if (!state || uid !== state.homeLodgeUid) return;
    clearCommanderClaim(state);
    detachCommanderFromLodge(context, state, commanderSoldierOf(soldiers, state), actorOf());
  };

  /**
   * Raiders destroyed the commander's Lodge (owner 2026-11-09): he is never lost. Inside, recovering,
   * evacuating or fighting on this island he is evicted wounded (at least 1 HP), hidden at the nearest
   * storage, and unavailable here until a Lodge is rebuilt (recovery and healing pause; the removal's
   * detach does the rehoming). Away on an expedition he is not on this island and stays untouched.
   * Campaign hook (C10): when this Lodge is not on his home island he returns home instead.
   */
  const lodgeDestroyed = (uid: number) => {
    if (!state || uid !== state.homeLodgeUid) return;
    if (!["field", "incapacitated", "lodge", "recovering", "travelling"].includes(state.location)) return;
    const soldier = commanderSoldierOf(soldiers, state), actor = actorOf(soldier), combat = soldier?.combat;
    if (!soldier || !actor || !combat) return;
    const wasDown = combat.hp <= 0 || ["incapacitated", "travelling"].includes(state.location);
    const recovering = wasDown || state.location === "recovering";
    combat.hp = Math.max(1, combat.hp);
    for (const key of ["target", "pendingTarget", "pendingAim", "siege"] as const) combat[key] = undefined;
    combat.attackTime = 0;
    const mount = context.actors.find(entry => entry.uid === combat.mount);
    if (mount) mount.visible = false;
    Object.assign(actor, { action: "idle", building: uid, home: uid, mounted: false, path: [], pathIndex: 0,
      phase: recovering ? "commanderRecovering" : "commanderLodge", visible: false });
    soldier.building = -1; soldier.stationed = false;
    state.location = recovering ? "recovering" : "lodge";
    if (wasDown) state.recoverySeconds = COMMANDER_RECOVERY_SECONDS;
  };

  /**
   * The commander without a standing Lodge (demolished or destroyed) moves into a rebuilt completed
   * one, the first in building order; resting and recovery resume there.
   */
  const adoptRebuiltLodge = (soldier: SettlementSoldier, actor: SettlementActor) => {
    if (!state || !["lodge", "recovering"].includes(state.location)) return undefined;
    const lodge = context.buildings.find(building => building.typeId === COMMANDER_LODGE_TYPE_ID &&
      building.construction === 1 && isOwnBuilding(building));
    if (!lodge) return undefined;
    state.homeLodgeUid = lodge.uid;
    Object.assign(actor, { action: "idle", building: lodge.uid, home: lodge.uid, path: [], pathIndex: 0,
      phase: state.location === "recovering" ? "commanderRecovering" : "commanderLodge", visible: false,
      x: lodge.doorThreshold.x, y: lodge.y, z: lodge.doorThreshold.z });
    soldier.building = -1; soldier.stationed = false;
    const mount = context.actors.find(entry => entry.uid === soldier.combat?.mount);
    if (mount) Object.assign(mount, { building: lodge.uid, home: lodge.uid, visible: false });
    return lodge;
  };

  const levelUpForDevelopment = () => {    if (!state) return { ok: false as const, reason: "No commander on this island" };
    if (context.options.developmentAllowed !== true)
      return { ok: false as const, reason: "Development tools are unavailable" };
    if (state.level >= COMMANDER_MAX_LEVEL)
      return { ok: false as const, reason: "The commander is already at maximum level" };
    const next = commanderNextThreshold(state.level);
    if (next === null) return { ok: false as const, reason: "The commander is already at maximum level" };
    const soldier = commanderSoldierOf(soldiers, state);
    const previousLevel = state.level, previousMaximum = commanderMaximumHealth(previousLevel);
    state.xp = Math.max(state.xp, next);
    state.level = commanderLevelForXp(state.xp);
    if (soldier?.combat) {
      const nextMaximum = commanderMaximumHealth(state.level);
      soldier.combat.hp = Math.max(0, Math.min(nextMaximum,
        nextMaximum * soldier.combat.hp / previousMaximum));
    }
    return { ok: true as const, level: state.level, xp: state.xp };
  };

  const restAtLodge = (dt: number) => {
    if (!state) return;
    const soldier = commanderSoldierOf(soldiers, state);
    const actor = actorOf(soldier);
    const lodge = lodgeOf();
    if (!soldier?.combat) return;
    if ((state.location === "lodge" || state.location === "recovering") && lodge && insideLodge(actor, lodge)) {
      const combat = soldier.combat;
      const maximum = commanderMaximumHealth(state.level);
      if (combat.hp > 0 && combat.hp < maximum) {
        state.healingSeconds += dt;
        while (state.healingSeconds + 1e-9 >= COMMANDER_HEAL_SECONDS && combat.hp < maximum) {
          state.healingSeconds -= COMMANDER_HEAL_SECONDS;
          combat.hp = Math.min(maximum, combat.hp + maximum * .01);
        }
        if (state.healingSeconds < 1e-9) state.healingSeconds = 0;
        if (combat.hp >= maximum) { combat.hp = maximum; state.healingSeconds = 0; }
      } else if (combat.hp >= maximum) state.healingSeconds = 0;
      if (state.location === "recovering") {
        state.recoverySeconds = Math.max(0, state.recoverySeconds - dt);
        if (state.recoverySeconds < 1e-9) state.recoverySeconds = 0;
        if (state.recoverySeconds <= 0) state.location = "lodge";
      }
    }
  };

  const update = (dt: number) => {
    if (!state || !Number.isFinite(dt) || dt <= 0) return;
    const soldier = commanderSoldierOf(soldiers, state);
    const actor = actorOf(soldier);
    if (!soldier || !actor) { setStatus(lodgeOf()); return; }
    const lodge = lodgeOf() ?? adoptRebuiltLodge(soldier, actor);
    if (state.location === "travelling" && actor.phase === "commanderEvacuating") {
      if (moveActor(context, actor, dt) && lodge) stabilize(soldier, actor, lodge);
    } else if (actor.phase === "commanderEvacuating" && lodge && moveActor(context, actor, dt)) {
      stabilize(soldier, actor, lodge);
    }
    if (state.location === "field" && (!soldier.combat || soldier.combat.hp <= 0)) incapacitate(soldier);
    transport.updateTransport(dt);
    restAtLodge(dt);
    setStatus(lodge);
  };

  /** Offline/fast catch-up: only eligible lodge rest; never movement, combat or a free stabilization. */
  const rest = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    restAtLodge(seconds);
    setStatus(lodgeOf());
  };

  const snapshot = (lodgeUid: number): CommanderSnapshot | undefined => {
    if (!state || state.homeLodgeUid !== lodgeUid) return undefined;
    return snapshotOf(state, lodgeOf());
  };

  const snapshotOf = (current: CommanderState, lodge: SettlementBuilding | undefined): CommanderSnapshot => {
    const soldier = commanderSoldierOf(soldiers, current);
    const maximum = commanderMaximumHealth(current.level);
    const hp = Math.max(0, Math.min(maximum, soldier?.combat?.hp ?? current.awayHp ?? 0));
    const derived = commanderBlockReason(current, hp, maximum);
    const needsHome = !lodge && ["lodge", "recovering", "muster", "reserved", "waiting"].includes(current.location);
    const blockReason: CommanderBlockReason | null = needsHome ? "missing-home" : derived;
    const transportDetail = commanderTransportReason(current);
    const healthDetail = blockReason === "too-injured"
      ? `Too injured to deploy: ${Math.ceil(hp)} / ${Math.ceil(maximum)} HP (50% required)` : null;
    const recoveryDetail = blockReason === "recovering"
      ? `Recovering: ${Math.ceil(current.recoverySeconds / 60)} minute(s) remaining` : null;
    const blockDetail = needsHome ? "No reachable friendly Commander's Lodge is available"
      : transportDetail ?? healthDetail ?? recoveryDetail;
    return {
      ...current,
      aura: { ...commanderDefinition(current.nation, current.definitionId).aura },
      blockDetail,
      blockReason,
      canReturn: commanderReturnReady(current),
      definition: { ...commanderDefinition(current.nation, current.definitionId),
        aura: { ...commanderDefinition(current.nation, current.definitionId).aura } },
      deckSlots: COMMANDER_DECK_SLOTS,
      developmentAllowed: context.options.developmentAllowed === true,
      healthReady: hp >= maximum * .5,
      hp,
      hpFraction: maximum > 0 ? hp / maximum : 0,
      maximumHp: maximum,
      nextThreshold: commanderNextThreshold(current.level),
      ready: blockReason === null && canDeployCommander(current, hp, maximum),
      recoveryComplete: current.recoverySeconds <= 0
    };
  };

  const restore = (saved?: CommanderSave) => {
    state = saved && isCommanderState(saved) ? copyCommanderState(saved) : undefined;
    if (state) context.options.commanderOwner?.claim(state.id, context.options.world.seed);
    // A restored commander is active again from its saved, validated soldier state.
  };
  const saveState = (): CommanderSave | undefined => state && copyCommanderState(state);

  /**
   * Aura/personal-damage modifiers at the resolved-impact milestone. Only one commander exists per
   * island, so the same effect cannot stack. Auras are inactive in buildings, aboard, in transit and
   * while incapacitated; ordinary rank damage was already applied by `militaryDamage`.
   */
  /** The hero's soldier and body while its aura is active (in the field or at a siege, alive and visible). */
  const activeSource = () => {
    if (!state) return undefined;
    const soldier = commanderSoldierOf(soldiers, state), source = actorOf(soldier);
    const active = Boolean(soldier?.combat && soldier.combat.hp > 0 && source?.visible &&
      ["militaryField", "militarySiege"].includes(source.phase));
    return active && soldier && source ? { soldier, source } : undefined;
  };
  /** A14-2 morale: where the active aura stands and how far it reaches (one read per tick). */
  const aura = () => {
    const active = activeSource();
    if (!active || !state) return undefined;
    const { radius } = commanderDefinition(state.nation, state.definitionId).aura;
    return { faction: active.soldier.combat!.faction, radius, uid: active.source.uid, x: active.source.x,
      z: active.source.z };
  };
  const modifyHit = ({ attacker, defender, random: roll, ranged }: CommanderHitContext): CommanderHitModifiers => {
    const active = activeSource();
    if (!state || !active) return { damageFactor: 1, dodge: false };
    const { soldier: sourceSoldier, source } = active;
    const definition: CommanderDefinition = commanderDefinition(state.nation, state.definitionId);
    const within = (soldier: SettlementSoldier) => {
      if (!friendly(soldier)) return false;
      const actor = context.actors.find(entry => entry.uid === soldier.actor);
      return Boolean(actor && DMath.hypot(actor.x - source.x, actor.z - source.z) <= definition.aura.radius);
    };
    let damageFactor = 1;
    if (sourceSoldier === attacker) damageFactor *= deterministicPow(COMMANDER_LEVEL_DAMAGE_FACTOR, state.level - 1);
    if (ranged && definition.aura.kind === "bowDamage" && within(attacker))
      damageFactor *= 1 + definition.aura.factor;
    if (!ranged && definition.aura.kind === "meleeDamage" && within(attacker))
      damageFactor *= 1 + definition.aura.factor;
    if (ranged && definition.aura.kind === "arrowReduction" && within(defender))
      damageFactor *= 1 - definition.aura.factor;
    let dodge = false;
    if (!ranged && definition.aura.kind === "meleeDodge" && within(defender))
      dodge = roll() < definition.aura.factor;
    return { damageFactor, dodge };
  };

  const recordMissionResult = (resultId: string) => awardExperience(resultId);

  const transport = createCommanderTransportController({
    actorOf: () => actorOf(), awardExperience, context, getState: () => state, lodgeOf: () => lodgeOf(),
    setState: (next: CommanderState | undefined) => { state = next; }, setStatus, snapshotOf,
    soldierOf: () => commanderSoldierOf(soldiers, state), soldiers
  });

  return {
    ...transport,
    aura, awardExperience, beforeBuildingRemoved, incapacitate, levelUpForDevelopment, lodgeDestroyed, modifyHit,
    recordMissionResult, recruit,
    deployToField: () => deployCommanderToField(context, state, commanderSoldierOf(soldiers, state), actorOf(), lodgeOf()),
    recoveryProblem: (id:string)=>commanderRecoveryProblem({ actors:context.actors,buildings:context.buildings,
      commander:state,islandSeed:context.options.world.seed,soldiers:[...soldiers.values()] },id),
    recoverWithItem: (id:string)=>recoverCommander({ actors:context.actors,buildings:context.buildings,
      commander:state,islandSeed:context.options.world.seed,soldiers:[...soldiers.values()] },id),
    recordDeath: (soldier: SettlementSoldier) => { if (state?.id === soldier.commanderId) state = undefined; },
    recruitAvailability: (uid: number) => commanderRecruitAvailability(context, uid, Boolean(state)),
    rangedStyle: () => state ? commanderDefinition(state.nation, state.definitionId).style === "ranged" : false,
    rest, restore, saveState, snapshot, snapshotAny: () => state && snapshotOf(state, lodgeOf()),
    update,
    /** Read-only test/debug view of the current location; not a second owner of the state. */
    state: () => state && copyCommanderState(state),
    soldier: () => commanderSoldierOf(soldiers, state)
  };
};

export type CommanderSystem = ReturnType<typeof createCommanderSystem>;
