import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { probeAccept } from "./faction-vision-probe";
import { fightingType, type MilitaryCombatant } from "./military-combat-rules";
import { militaryContactReach } from "./military-contact";
import type { CivilianHuntRouting, CivilianTargets } from "./military-civilian-targets";
import { manualBowTarget } from "./military-manual-archery";
import type { createMilitaryRiders } from "./military-riders";
import { nearestMilitaryStorage } from "./military-routing";
import type { createStructureAssault } from "./military-structure-assault";
import { corneredStance, type MilitaryStance, returnsToPost, stanceOf } from "./military-targeting";
import { updateTowerFall } from "./military-tower-collapse";
import { isPublicBuildingPointClear } from "./settlement-building-navigation";
import { type CombatCore, type FieldMemory, POINT_BLANK_REACH, profileOf } from "./settlement-combat-core";
import type { createCombatEngagement } from "./settlement-combat-engagement";
import type { createCombatMounting } from "./settlement-combat-mounting";
import type { CombatChase } from "./settlement-combat-chase";
import type { CombatRouting } from "./settlement-combat-routing";
import type { createCombatTargeting } from "./settlement-combat-targeting";
import type { SettlementSoldier } from "./settlement-military";
import { moveActor, setActorPath } from "./settlement-paths";
import { talentsOf } from "./settlement-talents";
import type { SettlementActor, SettlementContext } from "./settlement-types";
import { doorBlowDamage } from "./workshop-upgrades";

/** An enemy this close (tiles) ends a group's shared marching pace. */
const GROUP_MARCH_CONTACT = 6;
/** A swinging soldier closes in on a foe further than this share of its reach, up to this far beyond it. */
const FOLLOW_SHARE = .8;
const FOLLOW_REACH = 2;
/** A guard this close to its post stands at it. */
const POST_ARRIVAL = .5;

/** Stances in which a soldier shot from an open scaffold turns on its supports by itself. */
const SCAFFOLD_RESPONSE_STANCES: ReadonlySet<MilitaryStance> = new Set(["camp", "guard", "march", "seek"]);

/** Nothing solid (ground or a finished building) between the two bodies at chest height. */
const clearMeleeContact = (context: SettlementContext, actor: SettlementActor, target: SettlementActor) => {
  const distance = DMath.hypot(target.x - actor.x, target.z - actor.z);
  const samples = Math.max(1, Math.ceil(distance / .1)), { world } = context.options;
  for (let index = 1; index < samples; index++) {
    const fraction = index / samples;
    const x = actor.x + (target.x - actor.x) * fraction;
    const z = actor.z + (target.z - actor.z) * fraction;
    const height = actor.y + (target.y - actor.y) * fraction + .7;
    if (sampleSmooth(world, world.heights, x, z) > height) return false;
    if (!isPublicBuildingPointClear(context, { x, z }, 0)) return false;
  }
  return true;
};

const tickTimers = (state: MilitaryCombatant, memory: FieldMemory, dt: number) => {
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.routeAge = Math.max(0, (state.routeAge ?? 0) - dt);
  state.attackTime = Math.max(0, (state.attackTime ?? 0) - dt);
  memory.seekTime = Math.max(0, memory.seekTime - dt);
};

interface FieldServices {
  assault: ReturnType<typeof createStructureAssault>;
  chase: CombatChase;
  civilians: CivilianTargets;
  engagement: ReturnType<typeof createCombatEngagement>;
  mounting: ReturnType<typeof createCombatMounting>;
  riders: ReturnType<typeof createMilitaryRiders>;
  routing: CombatRouting;
  returnHome: (ids: readonly number[]) => boolean;
  targeting: ReturnType<typeof createCombatTargeting>;
}

/** The per-tick update of one soldier outside a door fight: leaving its building, or the field. */
export const createCombatField = ({
  actorById, archery, context, doors, grid, hit, inField, initialize, isKnownEnemyOf, memoryOf, pendingMarches,
  random, sieges, soldiers, steering, stuck
}: CombatCore, {
  assault, chase, civilians, engagement, mounting, returnHome, riders, routing, targeting
}: FieldServices) => {
  const { arrive, marchTo, move, plan, stand, walk } = routing;
  const { chooseTarget } = targeting;
  const { backAway, engage, pressArcher } = engagement;
  const { tryMountOnRoute } = mounting;
  const huntRouting: CivilianHuntRouting = { backAway, plan, stand, walk };
  /**
   * A melee soldier or rider shot from an open scaffold (or alerted by a struck comrade) cannot reach
   * the archer: it besieges the scaffold and strikes its supports (owner request 2026-10-22).
   */
  const turnOnScaffold = (state: MilitaryCombatant, stance: MilitaryStance, memory: FieldMemory) => {
    if (fightingType(state) === "archer" || state.siege !== undefined || !SCAFFOLD_RESPONSE_STANCES.has(stance)) return;
    const scaffold = assault.scaffoldOf(memory.lastAttacker, state.faction) ??
      assault.scaffoldOf(state.target, state.faction);
    if (scaffold === undefined) return;
    state.siege = scaffold;
    state.destination = undefined;
    state.target = undefined;
    memory.lastAttacker = undefined;
  };
  /** Lands the blow (or looses the arrow) started `attackTime` ago, if the target is still there. */
  const resolveBlow = (actor: SettlementActor, soldier: SettlementSoldier, state: MilitaryCombatant) => {
    if (state.pendingAim && (state.attackTime ?? 0) <= .15) {
      const aim = state.pendingAim;
      state.pendingAim = undefined;
      archery.fireAtPoint(soldier, actor, manualBowTarget(actor, aim, profileOf(state).range), aim.pitch / 32768 * Math.PI);
      return;
    }
    if (state.pendingTarget === undefined || (state.attackTime ?? 0) > .15) return;
    const pending = state.pendingTarget;
    const defender = soldiers.get(pending), target = archery.targetBody(pending);
    state.pendingTarget = undefined;
    if (!defender) {
      // The draw was aimed at a civilian outside a building (MIL-ASSAULT 2026-11-08).
      if (target && fightingType(state) === "archer" && civilians.isTarget(pending))
        archery.fireAtCivilian(soldier, target, actor);
      return;
    }
    if (!defender.combat || !target || defender.combat.faction === state.faction) return;
    const profile = profileOf(state);
    const distance = DMath.hypot(target.x - actor.x, target.z - actor.z);
    const full = random.at("combat.fieldContact", soldier.actor)() < .7 + soldier.rank * .1;
    if (state.closeQuarters && distance <= POINT_BLANK_REACH) {
      if (clearMeleeContact(context, actor, target)) hit(soldier, defender, full, true);
      return;
    }
    if (distance < profile.minimumRange ||
      distance > militaryContactReach(fightingType(state), profile.range, actor, defender.combat.type, target)) return;
    if (fightingType(state) === "archer") archery.fire(soldier, defender, actor);
    else if (clearMeleeContact(context, actor, target)) hit(soldier, defender, full);
  };
  /** A door blow (or a blow at assaulted walls) under way lands its damage at 75 % of the swing. */
  const resolveDoorBlow = (actor: SettlementActor, soldier: SettlementSoldier, state: MilitaryCombatant) => {
    if (!state.doorBlow || (state.attackTime ?? 0) > .15) return;
    if (assault.release(actor, soldier, state)) { state.doorBlow = undefined; return; }
    const door = state.siege === undefined ? undefined : doors.get(state.siege);
    if (door && door.faction !== state.faction) {
      door.hp = Math.max(0, door.hp - doorBlowDamage(state.type === "heavy" ? 20 : 10,
        door.faction, context.buildings.find(building => building.uid === door.building),
        talentsOf(context, door.faction).doorStrength));
    }
    state.doorBlow = undefined;
  };
  /** The melee soldier ahead of a siege bashes the enemy door until it breaks. */
  const bashDoor = (actor: SettlementActor, state: MilitaryCombatant) => {
    const door = state.siege === undefined ? undefined : doors.get(state.siege);
    const building = door && context.buildings.find(entry => entry.uid === door.building);
    if (!door || !building || building.eventCourtyard || door.faction === state.faction || door.hp <= 0 ||
      fightingType(state) === "archer") return false;
    const range = DMath.hypot(building.workerApproach.x - actor.x, building.workerApproach.z - actor.z);
    if (range > profileOf(state).range) {
      // The access in front of the door is open ground; the door step itself may sit inside the plot.
      plan(actor, state, building.access);
      return true;
    }
    stand(actor);
    actor.yaw = DMath.atan2(building.doorThreshold.x - actor.x, building.doorThreshold.z - actor.z);
    if (state.cooldown) return true;
    state.cooldown = profileOf(state).interval; state.attackTime = .6; actor.animationTime = 0;
    state.doorBlow = true;
    return true;
  };
  /** No one to fight: bash the besieged door, march on, or walk back to the guard post. */
  const carryOn = (actor: SettlementActor, state: MilitaryCombatant, stance: MilitaryStance,
    memory: FieldMemory, dt: number) => {
    if (stance === "march" || stance === "siege") memory.anchor = undefined;
    if (stance === "siege" && assault.update(actor, state, dt)) return;
    if (stance === "siege" && riders.approachDoor(actor, state, dt)) return;
    if (stance !== "move" && !actor.mounted && bashDoor(actor, state)) { walk(actor, dt); return; }
    if (state.destination) {
      if (marchTo(actor, state, state.destination, dt)) move(actor, dt);
      return;
    }
    memory.anchor ??= { x: actor.x, z: actor.z };
    const post = memory.anchor;
    if (returnsToPost(stance) && DMath.hypot(post.x - actor.x, post.z - actor.z) > POST_ARRIVAL) {
      plan(actor, state, post); walk(actor, dt); return;
    }
    if (returnsToPost(stance)) memory.ignored = undefined;
    walk(actor, dt);
  };
  /**
   * During a swing a rider rides on into its blow, keeping pace with a foe stepping away: an archer
   * backing off is no longer out of reach every time the blow lands. Foot soldiers plant their feet.
   */
  const followThrough = (actor: SettlementActor, state: MilitaryCombatant, dt: number) => {
    const foe = state.pendingTarget === undefined ? undefined : actorById(state.pendingTarget);
    const reach = profileOf(state).range;
    const distance = foe ? DMath.hypot(foe.x - actor.x, foe.z - actor.z) : 0;
    if (!foe || !inField(foe) || !actor.mounted || fightingType(state) === "archer" ||
      distance <= reach * FOLLOW_SHARE || distance > reach + FOLLOW_REACH) {
      actor.action = "idle"; steering.halt(actor.uid); return;
    }
    const share = (distance - reach * FOLLOW_SHARE) / distance;
    actor.path = [{ x: actor.x + (foe.x - actor.x) * share, z: actor.z + (foe.z - actor.z) * share }];
    actor.pathIndex = 0;
    move(actor, dt);
    actor.yaw = DMath.atan2(foe.x - actor.x, foe.z - actor.z);
  };
  const updateField = (actor: SettlementActor, soldier: SettlementSoldier, dt: number) => {
    if (updateTowerFall(actor, soldier, dt)) return;
    const state = initialize(soldier), memory = memoryOf(actor.uid);
    if (state.destination && DMath.hypot(state.destination.x - actor.x, state.destination.z - actor.z) < .08)
      arrive(actor, state);
    tickTimers(state, memory, dt);
    resolveDoorBlow(actor, soldier, state);
    resolveBlow(actor, soldier, state);
    if (context.commanderControl?.updateActor(actor, dt)) return;
    if ((state.attackTime ?? 0) > 0) { followThrough(actor, state, dt); return; }
    turnOnScaffold(state, stanceOf(state, state.faction > 0), memory);
    const stance = corneredStance(stanceOf(state, state.faction > 0), memory);
    // An explicit retreat ignores everything until it arrives.
    if (stance === "retreat") { state.target = undefined; carryOn(actor, state, stance, memory, dt); return; }
    // Contact breaks the march: each soldier then moves and fights at its own speed.
    if ((state.marchSpeed !== undefined || state.rallyRunning) &&
      grid.anyWithin(actor.x, actor.z, GROUP_MARCH_CONTACT, probeAccept("field.marchContact", state.faction,
        body => inField(body) && isKnownEnemyOf(state.faction)(body)))) {
      state.marchSpeed = undefined; state.rallyRunning = undefined;
    }
    if (fightingType(state) === "archer" && stance !== "move" && pressArcher(actor, state, memory, dt)) return;
    state.closeQuarters = undefined;
    // A targetMilitary lock overrides the target choice while its foe is in sight.
    const target = chase.target(actor, state, memory, dt) ?? chooseTarget(actor, state, stance, memory);
    state.target = target?.body.uid;
    if (target && memory.anchor === undefined) memory.anchor = { x: actor.x, z: actor.z };
    if (target && engage(actor, state, stance, target, dt)) return;
    // A field recruit fights on its ordinary march; safe arrival hands it to the real storage door flow.
    if (!target && !state.destination && state.returnToStorage && state.faction === 0 && returnHome([actor.uid]))
      return;
    // Civilians outside buildings are fair game once no soldier is in reach (owner 2026-11-09).
    if (!target && civilians.hunt(actor, state, soldier.rank, { anchor: memory.anchor, stance }, dt, huntRouting))
      return;
    carryOn(actor, state, stance, memory, dt);
  };
  /** Out of the door into the field: picks up the waiting route, the horse, or the way back to storage. */
  const finishLeaving = (actor: SettlementActor, soldier: SettlementSoldier, riding: boolean) => {
    actor.path = []; actor.pathIndex = 0;
    actor.phase = "militaryField"; actor.action = "idle";
    actor.mounted = false;
    soldier.building = -3;
    if (soldier.combat?.pendingRoute) {
      setActorPath(actor, soldier.combat.pendingRoute, "militaryField");
      soldier.combat.pendingRoute = undefined;
    }
    if (riding && soldier.combat) {
      soldier.combat.mountOnClear = true; soldier.combat.dismounted = true;
      tryMountOnRoute(actor, soldier.combat);
    }
    if (!soldier.combat?.returnToStorage) return;
    soldier.combat.returnToStorage = undefined;
    if (soldier.combat.dismounted) riders.mountNow(actor, soldier.combat);
    const choice = nearestMilitaryStorage(context, actor, soldier.combat.returnStorageUid);
    if (!choice) return;
    soldier.building = -2; actor.home = choice.home.uid; actor.building = choice.home.uid;
    setActorPath(actor, choice.path, actor.mounted ? "militaryMountedReturn" : "retire");
  };
  const updateLeaving = (actor: SettlementActor, soldier: SettlementSoldier, dt: number) => {
    const reached = moveActor(context, actor, dt);
    if (soldier.combat) stuck.update(actor, soldier.combat, dt);
    const final = actor.path.at(-1);
    // An exit ends in outdoor space. Release the exclusive lane once shoulders clear it,
    // rather than requiring every exiting soldier to occupy the same exact road point.
    const cleared = actor.pathIndex === actor.path.length - 1 && final &&
      DMath.hypot(final.x - actor.x, final.z - actor.z) < .32;
    // A dismounted rider leaving a door fight stays on foot; its horse waits where it left it.
    const riding = soldier.combat?.type === "cavalry" && !soldier.combat.dismounted;
    if (reached || cleared) finishLeaving(actor, soldier, riding);
  };
  const updateActor = (actor: SettlementActor, dt: number) => {
    if (pendingMarches.has(actor.uid)) return true;
    const rider = soldiers.get(actor.uid)?.combat;
    const manualHorse = context.commanderControl?.owns(actor.uid) || context.commanderControl?.managesHorse(actor.uid);
    if (rider?.mountOnClear && !manualHorse && actor.phase === "militaryField") tryMountOnRoute(actor, rider);
    if (rider?.dismounted && !manualHorse && !rider.mountOnClear && actor.phase === "militaryField" && !sieges.atDoor(actor.uid) &&
      riders.updateDismounted(actor, rider, stanceOf(rider, rider.faction > 0), dt)) return true;
    if (sieges.updateActor(actor, dt)) return true;
    const soldier = soldiers.get(actor.uid);
    if (!soldier || !["militaryLeaving", "militaryField"].includes(actor.phase)) return false;
    if (actor.phase === "militaryLeaving") {
      updateLeaving(actor, soldier, dt);
      return true;
    }
    updateField(actor, soldier, dt);
    if (soldier.combat) stuck.update(actor, soldier.combat, dt);
    return true;
  };
  return { updateActor };
};
