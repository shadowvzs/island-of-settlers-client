import {
  COMMANDER_INPUT_BUTTON, type CommanderInput, isCommanderInput
} from "../../../../island-of-settlers-shared/src/commander-input";
import { actorActionEnabled } from "../../render-common/workers/actor-action-capabilities";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { probeAccept } from "./faction-vision-probe";
import { fightingType } from "./military-combat-rules";
import { militaryContactReach } from "./military-contact";
import { createCommanderEscort } from "./military-direct-escort";
import { createMilitaryDirectHorse } from "./military-direct-horse";
import {
  COMMANDER_CONTROL_LEASE_TICKS, COMMANDER_ESCORT_LIMIT,   type CommanderFollowType, emptyMilitaryDirectSave,
type MilitaryDirectSave
} from "./military-direct-state";
import { cancelManualBowDraw, manualBowTarget } from "./military-manual-archery";
import { type CombatCore, profileOf } from "./settlement-combat-core";
import type { createCombatEngagement } from "./settlement-combat-engagement";
import type { CombatOrders } from "./settlement-combat-orders";
import type { CombatRouting } from "./settlement-combat-routing";
import { turnYawToward } from "./settlement-geometry";
import type { SettlementActor } from "./settlement-types";

const TAU = Math.PI * 2;

/** Acquire the intended foe before steering; hard body clearance still applies during the approach. */
const manualMeleeTarget = (core: CombatCore, actor: SettlementActor) => {
  const state = core.soldiers.get(actor.uid)!.combat!;
  const profile = profileOf(state);
  let target: SettlementActor | undefined;
  let nearest = Infinity;
  core.grid.forEachWithin(actor.x, actor.z, profile.range + 2, probeAccept("commander.manualMelee", state.faction,
    body => core.inField(body) && core.isKnownEnemyOf(state.faction)(body)), body => {
      const dx = body.x - actor.x, dz = body.z - actor.z, distance = DMath.hypot(dx, dz);
      const facing = DMath.atan2(dx, dz) - actor.yaw;
      if (Math.abs(DMath.atan2(DMath.sin(facing), DMath.cos(facing))) > .35 ||
        distance < profile.minimumRange || distance >= nearest) return;
      nearest = distance;
      target = body;
    });
  return target;
};

/** One canonical actor/horse pair; no explorer body, position proxy, independent HP or weapon timer. */
export const createMilitaryDirectControl = (core: CombatCore, routing: CombatRouting,
  engagement: Pick<ReturnType<typeof createCombatEngagement>, "beginStrike">, march: CombatOrders["march"]) => {
  const { actorById, context, memoryOf, soldiers } = core;
  let saved = emptyMilitaryDirectSave();
  const horse = createMilitaryDirectHorse(core, routing, () => saved);
  const escort = createCommanderEscort(core, () => saved, march);
  const tick = () => context.clock?.tick() ?? 0;
  const owns = (uid: number) => saved.lease?.actor === uid;
  const soldierOf = () => context.commander?.soldier();
  const bodyOf = () => { const soldier = soldierOf(); return soldier && actorById(soldier.actor); };
  const eligibility = (uid: number): string | null => {
    const soldier = soldierOf(), actor = bodyOf(), commander = context.commander?.state();
    if (!commander || !soldier || soldier.actor !== uid || soldier.commanderId !== commander.id)
      return "Only your existing commander can be controlled";
    if (!actor?.visible || actor.phase !== "militaryField" || !soldier.combat ||
      soldier.combat.faction !== 0 || soldier.combat.hp <= 0 || commander.recoverySeconds > 0)
      return "Commander must be alive and deployed in the field";
    if (actor.navalOrder !== undefined || commander.transport && commander.transport.phase !== "deployed" ||
      soldier.combat.siege !== undefined || soldier.combat.towerFall || soldier.combat.mountOnClear ||
      core.sieges.atDoor(uid) || core.pendingMarches.has(uid)) return "Commander is busy with another transition";
    if ((soldier.combat.attackTime ?? 0) > 0 || soldier.combat.pendingTarget !== undefined)
      return "Wait for the committed attack to finish";
    return null;
  };
  const releaseMovement = (actor: SettlementActor) => {
    const id = actor.uid, state = soldiers.get(id)?.combat;
    core.pendingMarches.delete(id); core.marches.forget(id); core.movement.leave(id);
    core.arriving.leave(id); core.settling.forget(id); core.stuck.forget(id);
    core.mountChecks.delete(id); core.melee.forget(id); core.steering.forget(id);
    if (state) {
      state.destination = undefined; state.pendingRoute = undefined; state.target = undefined;
      state.siege = undefined; state.order = undefined; state.marchSpeed = undefined; state.rallyRunning = undefined;
    }
    routing.stand(actor);
    memoryOf(id).anchor = { x: actor.x, z: actor.z };
  };
  const end = (generation: number) => {
    if (saved.lease?.generation !== generation) return false;
    const actor = actorById(saved.lease.actor);
    const combat = soldiers.get(saved.lease.actor)?.combat;
    if (combat) cancelManualBowDraw(combat);
    if (actor?.phase === "militaryField") releaseMovement(actor);
    saved.lease = undefined; saved.guard = 0;
    return true;
  };
  const begin = (uid: number) => {
    if (saved.lease) return { ok: false as const, reason: "A commander is already controlled" };
    const reason = eligibility(uid);
    if (reason) return { ok: false as const, reason };
    if (saved.nextGeneration >= 0x7fffffff) return { ok: false as const, reason: "Control generation exhausted" };
    const actor = actorById(uid)!, soldier = soldierOf()!, generation = saved.nextGeneration++;
    releaseMovement(actor);
    if (!actor.mounted && soldier.combat?.dismounted && soldier.combat.mount !== undefined) {
      const mount = actorById(soldier.combat.mount);
      if (mount) {
        mount.visible = true;
        saved.horse ??= { actor: uid, horse: mount.uid, phase: "waiting", timer: 0, replan: 0 };
      }
    }
    saved.lease = { actor: uid, commanderId: soldier.commanderId!, generation, lastInputTick: tick(),
      processedButtons: 0,
      expiresTick: tick() + COMMANDER_CONTROL_LEASE_TICKS,
      input: { generation, forward: 0, right: 0,
        heading: Math.round(((actor.yaw / TAU % 1 + 1) % 1) * 65536) % 65536, pitch: 0, buttons: 0 } };
    return { ok: true as const, generation };
  };
  const submit = (input: CommanderInput) => {
    const lease = saved.lease;
    if (!isCommanderInput(input) || !lease || input.generation !== lease.generation ||
      tick() >= lease.expiresTick || tick() <= lease.lastInputTick) return false;
    const actor = actorById(lease.actor), soldier = soldiers.get(lease.actor);
    if (!actor?.visible || actor.phase !== "militaryField" || (soldier?.combat?.hp ?? 0) <= 0) return false;
    lease.lastInputTick = tick(); lease.expiresTick = tick() + COMMANDER_CONTROL_LEASE_TICKS;
    const enabled = (action: string) => actorActionEnabled("commander", action);
    let forward = input.forward;
    if (!enabled("move") || forward > 0 && !enabled("forward") || forward < 0 && !enabled("backward")) forward = 0;
    let buttons = 0;
    for (const [action, flag] of Object.entries(COMMANDER_INPUT_BUTTON))
      if (enabled(action)) buttons |= input.buttons & flag;
    lease.input = { ...input, forward, right: enabled("move") ? input.right : 0, buttons,
      heading: enabled("look") ? input.heading : lease.input.heading,
      pitch: enabled("look") ? input.pitch : lease.input.pitch };
    return true;
  };
  const move = (actor: SettlementActor, input: CommanderInput, dt: number) => {
    const state = soldiers.get(actor.uid)!.combat!;
    const heading = input.heading / 65536 * TAU;
    actor.yaw = turnYawToward(actor.yaw, heading, (actor.mounted ? 4 : 8) * dt);
    if (!actorActionEnabled("commander", "move") || !input.forward && !input.right || saved.guard > 0) {
      routing.stand(actor); return;
    }
    const magnitude = Math.max(127, DMath.hypot(input.forward, input.right));
    const forward = input.forward / magnitude, right = input.right / magnitude;
    const point = { x: actor.x + DMath.sin(heading) * forward + DMath.cos(heading) * right,
      z: actor.z + DMath.cos(heading) * forward - DMath.sin(heading) * right };
    actor.path = [point]; actor.pathIndex = 0;
    const yaw = actor.yaw;
    routing.move(actor, dt);
    actor.yaw = yaw;
    actor.y = sampleSmooth(context.options.world, context.options.world.heights, actor.x, actor.z);
    state.routeAge = 0;
  };
  /** Normal field resolution supplies damage/armour/RNG at its existing milestone. */
  const requestAttack = (actor: SettlementActor, input: CommanderInput, dt: number) => {
    const state = soldiers.get(actor.uid)!.combat!;
    if (!actorActionEnabled("commander", "attack") || !(input.buttons & COMMANDER_INPUT_BUTTON.attack) ||
      state.cooldown > 0 || (state.attackTime ?? 0) > 0 || saved.guard > 0) return;
    const profile = profileOf(state);
    if (fightingType(state) === "archer") {
      routing.stand(actor);
      state.target = undefined;
      state.closeQuarters = undefined;
      state.cooldown = profile.interval; state.attackTime = .6; actor.animationTime = 0;
      state.pendingAim = { heading: Math.round(((actor.yaw / TAU % 1 + 1) % 1) * 65536) % 65536,
        pitch: input.pitch };
      return;
    }
    const target = manualMeleeTarget(core, actor);
    if (!target) return;
    const distance = DMath.hypot(target.x - actor.x, target.z - actor.z);
    if (distance > militaryContactReach(fightingType(state), profile.range, actor,
      soldiers.get(target.uid)!.combat!.type, target) || !core.melee.approach(actor, state, target).admitted) return;
    state.target = target.uid;
    engagement.beginStrike(actor, state, target, dt);
  };
  /** Runs after the ordinary cooldown and impact resolver; never decrements them a second time. */
  const updateActor = (actor: SettlementActor, dt: number) => {
    const lease = saved.lease;
    if (!lease || lease.actor !== actor.uid) return false;
    const soldier = soldiers.get(actor.uid), commander = context.commander?.state();
    if (tick() >= lease.expiresTick || !actor.visible || actor.phase !== "militaryField" ||
      soldier?.commanderId !== lease.commanderId || commander?.id !== lease.commanderId ||
      (soldier.combat?.hp ?? 0) <= 0 || actor.navalOrder !== undefined) {
      end(lease.generation); return false;
    }
    const pressed = lease.input.buttons & ~lease.processedButtons;
    lease.processedButtons = lease.input.buttons;
    if (soldier.combat?.pendingAim && !(lease.input.buttons & COMMANDER_INPUT_BUTTON.attack))
      cancelManualBowDraw(soldier.combat);
    if ((soldier.combat?.attackTime ?? 0) > 0) { routing.stand(actor); return true; }
    if ((pressed & COMMANDER_INPUT_BUTTON.block) && actorActionEnabled("commander", "block") &&
      saved.guardRecovery === 0) { saved.guard = .5; saved.guardRecovery = 2; }
    if ((pressed & COMMANDER_INPUT_BUTTON.dismount) && actorActionEnabled("commander", "dismount")) horse.dismount();
    if ((pressed & COMMANDER_INPUT_BUTTON.callHorse) && actorActionEnabled("commander", "callHorse")) horse.call();
    if (horse.mounting(actor.uid)) { routing.stand(actor); return true; }
    if (soldier.combat && fightingType(soldier.combat) !== "archer") {
      soldier.combat.target = lease.input.buttons & COMMANDER_INPUT_BUTTON.attack
        ? manualMeleeTarget(core, actor)?.uid : undefined;
    }
    move(actor, lease.input, dt); requestAttack(actor, lease.input, dt);
    return true;
  };
  const assign = (uids: readonly number[]) => {
    const accepted: number[] = [];
    if (!Array.isArray(uids) || uids.length > COMMANDER_ESCORT_LIMIT) return accepted;
    for (const uid of uids) {
      if (saved.roster.length >= COMMANDER_ESCORT_LIMIT) break;
      const soldier = soldiers.get(uid), actor = actorById(uid);
      if (!soldier?.combat || soldier.commanderId || soldier.combat.faction !== 0 || soldier.combat.hp <= 0 ||
        soldier.stationed || !actor?.visible || actor.phase !== "militaryField" || actor.navalOrder !== undefined ||
        soldier.combat.siege !== undefined || core.sieges.atDoor(uid) || saved.roster.includes(uid)) continue;
      saved.roster.push(uid); accepted.push(uid); saved.escort.anchor = undefined;
    }
    return accepted;
  };
  const follow = (type: CommanderFollowType | "all", enabled: boolean) => {
    if (typeof enabled !== "boolean" || !["all", "shield", "heavy", "archer"].includes(type)) return false;
    if (type === "all") saved.follow = { shield: enabled, heavy: enabled, archer: enabled };
    else saved.follow[type] = enabled;
    saved.escort.anchor = undefined;
    if (!enabled) for (const id of saved.roster) {
      const soldier = soldiers.get(id), actor = actorById(id);
      if (actor?.phase === "militaryField" && (type === "all" || soldier?.combat?.type === type)) releaseMovement(actor);
    }
    return true;
  };
  const update = (dt: number) => {
    if (!saved.lease && !saved.horse && !saved.roster.length && !saved.guard && !saved.guardRecovery) return;
    saved.guard = saved.guard - dt > 1e-9 ? saved.guard - dt : 0;
    saved.guardRecovery = saved.guardRecovery - dt > 1e-9 ? saved.guardRecovery - dt : 0;
    if (saved.lease && tick() >= saved.lease.expiresTick) end(saved.lease.generation);
    horse.update(dt); escort.update(dt);
  };
  return { assign, begin, eligibility, end, follow, owns, submit, update, updateActor,
    managesHorse: horse.manages,
    prepareOrder: (uid: number) => { if (owns(uid)) return false; horse.cancel(uid); return true; },
    speedShare: (uid: number) => owns(uid) ? Math.min(1, DMath.hypot(saved.lease!.input.forward, saved.lease!.input.right) / 127) : 1,
    forget: (uid: number) => {
      if (owns(uid)) end(saved.lease!.generation);
      horse.cancel(uid); saved.roster = saved.roster.filter(id => id !== uid);
    },
    defenceFactor: (attacker: SettlementActor, defender: SettlementActor) => {
      if (!owns(defender.uid) || saved.guard <= 0) return 1;
      const angle = DMath.atan2(attacker.x - defender.x, attacker.z - defender.z) - defender.yaw;
      return Math.abs(DMath.atan2(DMath.sin(angle), DMath.cos(angle))) <= Math.PI / 3 ? .5 : 1;
    },
    detach: (uid: number) => { saved.roster = saved.roster.filter(id => id !== uid); },
    save: (): MilitaryDirectSave | undefined => {
      if (saved.nextGeneration === 1 && !saved.lease && !saved.horse && !saved.roster.length &&
        !saved.guard && !saved.guardRecovery && Object.values(saved.follow).every(Boolean)) return undefined;
      const result = structuredClone(saved);
      result.roster = result.roster.filter(id => soldiers.has(id));
      if (result.lease && !soldiers.has(result.lease.actor)) result.lease = undefined;
      if (result.horse && !soldiers.has(result.horse.actor)) result.horse = undefined;
      return result;
    },
    restore: (value?: MilitaryDirectSave) => { saved = value ? structuredClone(value) : emptyMilitaryDirectSave(); },
    state: () => saved,
    snapshot: () => {
      const lease = saved.lease, actor = lease && actorById(lease.actor);
      const commander = context.commander?.snapshotAny();
      if (!lease || !actor || !commander || commander.id !== lease.commanderId) return null;
      const combat = soldiers.get(actor.uid)?.combat;
      let aimPoint: ReturnType<typeof manualBowTarget> | undefined;
      if (combat && fightingType(combat) === "archer") {
        const aim = combat.pendingAim ?? { heading:
          Math.round(((actor.yaw / TAU % 1 + 1) % 1) * 65536) % 65536, pitch: lease.input.pitch };
        aimPoint = manualBowTarget(actor, aim, profileOf(combat).range);
      }
      return { actor: actor.uid, generation: lease.generation, commanderId: lease.commanderId,
        name: commander.name, nation: commander.nation, hp: commander.hp, maximumHp: commander.maximumHp,
        mounted: actor.mounted === true, x: actor.x, y: actor.y, z: actor.z, yaw: actor.yaw,
        pitch: lease.input.pitch / 32768 * Math.PI, definition: commander.definition,
        guard: saved.guard, guardRecovery: saved.guardRecovery,
        aimPoint,
        followers: [...saved.roster], follow: { ...saved.follow } };
    }
  };
};
export type MilitaryDirectControl = ReturnType<typeof createMilitaryDirectControl>;
