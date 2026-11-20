import { banditCampPlan, isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { GARRISON_CAPACITIES, MAX_DOOR_ATTACKERS } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import type { MilitaryStructure } from "./fort-assault-rules";
import {
  fightingType, type MilitaryCombatant, type MilitaryDoor, militaryHealth, militaryTroopTool
} from "./military-combat-rules";
import { restoreEntries, saveEntries, type SavedEntries } from "./military-field-save";
import { garrisonDefenderPriority } from "./military-garrison-rules";
import { militaryGroundPath } from "./military-routing";
import { entrancePath } from "./settlement-entrance";
import { distanceBetween } from "./settlement-geometry";
import type { SettlementSoldier } from "./settlement-military";
import { ownerOf } from "./settlement-ownership";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import { createSiegeDoorFight, duelReady } from "./settlement-siege-door-fight";
import { ARRIVAL_DISTANCE, createSiegeQueue, type SiegeQueueSave } from "./settlement-siege-queue";
import { createSiegeSlots, siegeStance as stance } from "./settlement-siege-slots";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import type { AuditedRandom } from "./simulation-random";

export interface MilitaryDoorExchange {
  building: number; attacker: number; defender?: number;
  stage: "approach" | "duel" | "capture" | "return";
}
/** Serialized doorway exchanges share the real door lane, never a teleport/capture timer. */
/**
 * A reserved door attacker that comes no nearer to the entrance for this long (seconds; boxed in by
 * the crowd under the walls) hands the duel to whoever is nearest the door.
 */
const APPROACH_PATIENCE = 10;
/** Getting this much nearer to the entrance counts as progress. */
const APPROACH_PROGRESS = .5;
/** Guards stay inside until the lead attacker reaches the entrance, including rotated doors. */
const DEFENDER_ENTRANCE_DISTANCE = 1.5;
/** Soldiers approaching the target stop sharing their group's long-distance marching pace. */
const INDEPENDENT_APPROACH_DISTANCE = 8;

/** Soldiers a besieged building holds: a bandit camp's own plan, otherwise its garrison capacity. */
const besiegedCapacity = (site: SettlementBuilding | undefined) => {
  if (site?.bandit !== undefined) return banditCampPlan(site.bandit).capacity;
  return site ? GARRISON_CAPACITIES[site.typeId] ?? 0 : 0;
};

interface SiegeGarrisonSite {
  actor: (id: number) => SettlementActor | undefined;
  building: (id: number) => SettlementBuilding | undefined;
  doors: Map<number, MilitaryDoor>;
  exchanges: ReadonlyMap<number, MilitaryDoorExchange>;
  soldiers: Map<number, SettlementSoldier>;
}
/** Puts one field soldier inside its building at the door step, hidden, as part of the garrison. */
const stationSoldier = (site: SettlementBuilding, soldier: SettlementSoldier, body: SettlementActor) => {
  soldier.building = site.uid; soldier.stationed = true; soldier.combat!.siege = undefined;
  body.building = site.uid; body.phase = "garrison"; body.visible = false; body.action = "idle";
  body.x = site.doorThreshold.x; body.z = site.doorThreshold.z; body.y = site.y;
  body.path = []; body.pathIndex = 0;
  soldier.combat!.hp = Math.min(soldier.combat!.hp, militaryHealth(soldier.combat!.type, soldier.rank));
};
/** Stations field soldiers of `faction` inside a finished building as its garrison. */
const registerSiegeGarrison = (
  { actor, building, doors, exchanges, soldiers }: SiegeGarrisonSite, uid: number, ids: readonly number[],
  faction: number, hp: number, structure?: MilitaryStructure
) => {
  const site = building(uid), capacity = besiegedCapacity(site);
  if (!site || site.construction !== 1 || !capacity || ids.length > capacity ||
    new Set(ids).size !== ids.length || !Number.isSafeInteger(faction) || faction <= 0 ||
    !Number.isFinite(hp) || hp <= 0 || exchanges.has(uid) ||
    Object.values(site.incoming).some(count => count > 0) ||
    [...soldiers.values()].some(soldier => soldier.building === uid)) return false;
  const assigned = ids.map(id => soldiers.get(id));
  if (assigned.some(soldier => !soldier?.combat || soldier.combat.faction !== faction ||
    soldier.combat.type === "cavalry" || soldier.building !== -3 || actor(soldier.actor)?.navalOrder !== undefined ||
    actor(soldier.actor)?.phase !== "militaryField")) return false;
  doors.set(uid, { building: uid, faction, hp, maximum: hp, ...(structure && { structure: { ...structure } }) });
  site.militaryFaction = faction;
  for (const soldier of assigned as SettlementSoldier[]) stationSoldier(site, soldier, actor(soldier.actor)!);
  return true;
};

/**
 * A computer field soldier back at its own garrisoned building goes in again while the building is
 * not under attack and has room (raiders returning home, MIL-ASSAULT 2026-11-09). Riders never do.
 */
const rejoinSiegeGarrison = (
  { actor, building, doors, exchanges, soldiers }: SiegeGarrisonSite, id: number, uid: number
) => {
  const site = building(uid), soldier = soldiers.get(id), body = actor(id), door = doors.get(uid);
  const state = soldier?.combat;
  if (!site || !soldier || !state || !body || !door || site.construction !== 1 || exchanges.has(uid) ||
    door.faction !== state.faction || ownerOf(site) !== state.faction || state.type === "cavalry" ||
    soldier.building !== -3 || body.phase !== "militaryField" || (door.structure?.hp ?? 1) <= 0) return false;
  let inside = 0;
  for (const other of soldiers.values()) if (other.building === uid) inside++;
  if (inside >= besiegedCapacity(site)) return false;
  Object.assign(state, { destination: undefined, order: undefined, pendingTarget: undefined, target: undefined });
  stationSoldier(site, soldier, body);
  return true;
};

interface SiegeApproach { nearest: number; waited: number }
export interface SiegeFieldSave {
  approaches: SavedEntries<SiegeApproach>; helpers: SavedEntries<number[]>; queue: SiegeQueueSave;
}

export const createSettlementSieges = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, doors: Map<number, MilitaryDoor>,
  hit: (attacker: SettlementSoldier, defender: SettlementSoldier, full: boolean, pointBlank?: boolean,
    multiplier?: number, archerPost?: boolean) => void,
  random: AuditedRandom,
  battle: {
    /** A waiting attacker with an enemy to fight leaves the queue to the field behaviour. */
    engaged: (body: SettlementActor, state: MilitaryCombatant) => boolean;
    /** The tick's actor index. */
    actorById: (id: number) => SettlementActor | undefined;
    /** Walks a soldier outside buildings one tick along its path, round the others (true once done). */
    steer: (body: SettlementActor, dt: number) => boolean;
    /** Seconds a walking soldier has been held on one spot by the bodies round it. */
    heldSeconds: (uid: number) => number;
  }
) => {
  const exchanges = new Map<number, MilitaryDoorExchange>();
  const actor = battle.actorById;
  const { forgetSite, siteSlots } = createSiegeSlots(context);
  const queue = createSiegeQueue(context, battle, siteSlots);
  const { doorDistance, lowerWeapon, nearestBasher, strike } = createSiegeDoorFight(soldiers, actor, hit, random);
  /** Stalled approaches by building: nearest distance reached and seconds since. */
  const approaches = new Map<number, SiegeApproach>();
  /** Riders on horseback never queue or take a door fight; a dismounted rider fights on foot. */
  const onFoot = (soldier: SettlementSoldier) => !actor(soldier.actor)?.mounted;
  const building = (id: number) => context.buildings.find(entry => entry.uid === id);
  const defenders = (uid: number) => [...soldiers.values()].filter(soldier => soldier.building === uid &&
    (soldier.combat?.faction ?? 0) === doors.get(uid)?.faction && building(uid)?.catapultSupply?.porter?.actor !== soldier.actor).sort((a, b) =>
      garrisonDefenderPriority(building(uid)?.typeId, a.combat?.type) -
      garrisonDefenderPriority(building(uid)?.typeId, b.combat?.type) || a.actor - b.actor);
  /** Extra door attackers per building (by id: one per flank); retained during the duel. */
  const helpers = new Map<number, number[]>();
  const resetWeapon = (soldier: SettlementSoldier) => {
    if (!soldier.combat) return;
    soldier.combat.doorMelee = undefined; soldier.combat.attackTime = 0;
    soldier.combat.pendingTarget = undefined;
    const body = actor(soldier.actor);
    if (body) body.tool = militaryTroopTool(soldier.combat.type);
  };
  const returnDefender = (exchange: MilitaryDoorExchange) => {
    const soldier = exchange.defender === undefined ? undefined : soldiers.get(exchange.defender);
    const body = soldier && actor(soldier.actor), site = building(exchange.building);
    if (!soldier || !body || !site) { exchanges.delete(exchange.building); return; }
    if (soldier.stationed) { exchanges.delete(exchange.building); return; }
    resetWeapon(soldier); exchange.stage = "return";
    // Pushed aside in the crowd, the defender first steps back onto the open access, then into the lane.
    setActorPath(body, [site.access, ...entrancePath(site)], "militarySiege");
  };
  const releaseAttacker = (exchange: MilitaryDoorExchange) => {
    const soldier = soldiers.get(exchange.attacker), body = actor(exchange.attacker);
    if (soldier) { resetWeapon(soldier); soldier.combat!.siege = undefined; }
    if (body?.phase === "militarySiege") {
      // Leaving a cancelled exchange still follows the building's own passage.
      const site = building(exchange.building);
      if (site) setActorPath(body, [site.access], "militaryLeaving");
      else { body.phase = "militaryField"; body.action = "idle"; body.path = []; body.pathIndex = 0; }
    }
  };
  const cancel = (id: number) => {
    for (const exchange of exchanges.values()) {
      if (exchange.attacker !== id) continue;
      releaseAttacker(exchange); returnDefender(exchange);
    }
  };
  const start = (site: SettlementBuilding, attacker: SettlementSoldier) => {
    const body = actor(attacker.actor)!;
    const defender = defenders(site.uid)[0];
    if (attacker.combat!.type === "archer" && defender) return;
    const route = groundPath(context, body, site.access);
    if (!route) return;
    const exchange: MilitaryDoorExchange = { building: site.uid, attacker: attacker.actor,
      defender: defender?.actor, stage: defender ? "approach" : "capture" };
    exchanges.set(site.uid, exchange);
    body.building = site.uid;
    setActorPath(body, [...route, ...(defender ? [stance(site, .65)] : entrancePath(site))], "militarySiege");
  };
  /** Reserving a doorway exchange must not send a guard outside while attackers are still travelling. */
  const approachDefender = (site: SettlementBuilding, exchange: MilitaryDoorExchange) => {
    if (exchange.stage !== "approach" || exchange.defender === undefined) return;
    const defender = soldiers.get(exchange.defender), attacker = actor(exchange.attacker);
    const guard = defender && actor(defender.actor);
    if (!defender?.stationed || !guard || !attacker ||
      distanceBetween(attacker, site.workerApproach) > DEFENDER_ENTRANCE_DISTANCE) return;
    defender.stationed = false; guard.visible = true;
    setActorPath(guard, [stance(site, 0)], "militarySiege");
  };
  /** A distant reservation yields to a soldier that actually reaches the entrance first. */
  const firstArrival = (site: SettlementBuilding, exchange: MilitaryDoorExchange) => {
    if (exchange.stage !== "approach" || !soldiers.get(exchange.defender!)?.stationed) return;
    const reserved = actor(exchange.attacker);
    if (!reserved || distanceBetween(reserved, site.workerApproach) <= DEFENDER_ENTRANCE_DISTANCE) return;
    const ready = [...soldiers.values()].filter(soldier => soldier.combat?.siege === site.uid &&
      soldier.combat.faction !== site.militaryFaction && fightingType(soldier.combat) !== "archer" && onFoot(soldier) &&
      actor(soldier.actor)?.phase === "militaryField" &&
      distanceBetween(actor(soldier.actor)!, site.workerApproach) <= DEFENDER_ENTRANCE_DISTANCE)
      .sort((a, b) => doorDistance(site, a) - doorDistance(site, b) || a.actor - b.actor)[0];
    if (!ready) return;
    requeue(site, reserved);
    start(site, ready);
  };
  /** The previous lead returns to the field queue without abandoning its siege order. */
  const requeue = (site: SettlementBuilding, reserved: SettlementActor) => {
    reserved.phase = "militaryField"; reserved.path = []; reserved.pathIndex = 0; reserved.action = "idle";
    exchanges.delete(site.uid); approaches.delete(site.uid);
  };
  /** A reservation whose attacker stopped getting nearer is dropped; the next door duel goes to the nearest. */
  const dropStalledApproach = (site: SettlementBuilding, exchange: MilitaryDoorExchange, dt: number) => {
    const reserved = actor(exchange.attacker);
    if (exchange.stage !== "approach" || !soldiers.get(exchange.defender!)?.stationed || !reserved) {
      approaches.delete(site.uid);
      return;
    }
    const distance = distanceBetween(reserved, site.workerApproach), approach = approaches.get(site.uid);
    if (!approach || distance < approach.nearest - APPROACH_PROGRESS) {
      approaches.set(site.uid, { nearest: distance, waited: 0 });
      return;
    }
    approach.waited += dt;
    if (approach.waited >= APPROACH_PATIENCE) requeue(site, reserved);
  };
  const update = (dt: number) => {
    queue.advance();
    for (const exchange of Array.from(exchanges.values())) {
      const site = building(exchange.building), attacker = soldiers.get(exchange.attacker);
      if (!site || site.construction !== 1) {
        releaseAttacker(exchange); exchanges.delete(exchange.building); continue;
      }
      if (exchange.stage !== "return" && (!attacker || attacker.combat?.siege !== site.uid)) {
        releaseAttacker(exchange); returnDefender(exchange); continue;
      }
      firstArrival(site, exchange);
      if (exchanges.get(site.uid) === exchange) dropStalledApproach(site, exchange, dt);
      approachDefender(site, exchanges.get(site.uid) ?? exchange);
      if (exchange.stage === "duel" && !soldiers.has(exchange.defender!)) {
        // A surviving attacker must reset at the access before the next guard leaves.
        const body = actor(exchange.attacker)!;
        lowerWeapons(exchange);
        setActorPath(body, [site.access], "militaryLeaving");
        exchanges.delete(exchange.building);
      }
    }
    for (const uid of helpers.keys()) if (exchanges.get(uid)?.stage !== "duel") helpers.delete(uid);
    for (const door of doors.values()) {
      const site = building(door.building);
      // Captured buildings (faction 0) are besieged by the computer the same way.
      if (!site || site.militaryFaction === undefined) continue;
      if(isOpenArcherTower(site)||site.eventCourtyard)continue;
      const attackers = [...soldiers.values()].filter(soldier => soldier.combat?.siege === site.uid &&
        soldier.combat.faction !== door.faction && actor(soldier.actor)?.phase === "militaryField" && onFoot(soldier))
        // The nearest waiting attacker takes the next door duel, not the lowest id far away.
        .sort((a, b) => doorDistance(site, a) - doorDistance(site, b) || a.actor - b.actor);
      if (exchanges.has(site.uid)) { assignHelpers(site, attackers); continue; }
      const defended = defenders(site.uid).length > 0;
      // Walls under direct assault are never captured: with no defender left they are struck instead.
      if (door.structure && !defended) continue;
      // Capture is foot-only: a dismounted rider fights at the door but never walks in to take it.
      const ready = defended ? attackers.find(soldier => soldier.combat?.type !== "archer")
        : attackers.find(soldier => soldier.combat?.type !== "cavalry");
      if (ready && (!door.hp || defenders(site.uid).length)) start(site, ready);
    }
  };
  /** The nearest waiting melee attackers join a door fight on its flanks, up to `MAX_DOOR_ATTACKERS` in all. */
  const assignHelpers = (site: SettlementBuilding, attackers: readonly SettlementSoldier[]) => {
    const exchange = exchanges.get(site.uid)!;
    // Flank stances are taken once the duel is on: a helper standing there earlier blocks the duellist's way in.
    if (exchange.defender === undefined || exchange.stage !== "duel") return;
    const flanks = siteSlots(site).flanks;
    const eligible = attackers.filter(soldier => soldier.combat?.type !== "archer").map(soldier => soldier.actor);
    // Keep an assigned flank while walking to it; re-ranking moving soldiers can swap their places every tick.
    const retained = (helpers.get(site.uid) ?? []).filter(id => eligible.includes(id));
    const limit = Math.min(MAX_DOOR_ATTACKERS - 1, flanks.length);
    const chosen = retained.slice(0, limit);
    const waiting = eligible.filter(id => !retained.includes(id));
    while (chosen.length < limit) {
      const flank = flanks[chosen.length]!;
      // Also reconstructs the same flank assignments after a save/load at the door.
      waiting.sort((a, b) => distanceBetween(actor(a)!, flank) - distanceBetween(actor(b)!, flank) || a - b);
      const index = waiting.findIndex(id => militaryGroundPath(context, actor(id)!, flank));
      if (index < 0) break;
      chosen.push(waiting.splice(index, 1)[0]!);
    }
    if (chosen.length) helpers.set(site.uid, chosen);
  };
  /** An extra door attacker takes its flank stance and strikes the defender while the duel lasts. */
  const helpAtDoor = (body: SettlementActor, soldier: SettlementSoldier, site: SettlementBuilding, dt: number) => {
    const index = helpers.get(site.uid)!.indexOf(body.uid), exchange = exchanges.get(site.uid)!;
    const arrived = queue.walkTo(body, siteSlots(site).flanks[index]!, dt);
    const defender = exchange.defender === undefined ? undefined : soldiers.get(exchange.defender);
    if (arrived && exchange.stage === "duel" && defender) strike(body, soldier, defender, dt);
  };
  /** A flank attacker standing at its stance takes over a duel whose attacker fell. */
  const promoteHelper = (exchange: MilitaryDoorExchange) => {
    const site = building(exchange.building);
    if (!site || exchange.stage !== "duel") return false;
    const flanks = siteSlots(site).flanks;
    const ready = (helpers.get(site.uid) ?? []).find((id, index) => {
      const body = actor(id), flank = flanks[index];
      return body && flank && DMath.hypot(body.x - flank.x, body.z - flank.z) <= ARRIVAL_DISTANCE;
    });
    const body = ready === undefined ? undefined : actor(ready);
    if (!body) return false;
    exchange.attacker = body.uid; body.building = site.uid;
    body.phase = "militarySiege"; body.path = []; body.pathIndex = 0;
    helpers.set(site.uid, helpers.get(site.uid)!.filter(id => id !== body.uid));
    return true;
  };
  /** The attacker and its flank attackers lower their weapons when the defender falls. */
  const lowerWeapons = (exchange: MilitaryDoorExchange) => {
    for (const id of [exchange.attacker, ...helpers.get(exchange.building) ?? []]) lowerWeapon(id);
  };
  const updateActor = (body: SettlementActor, dt: number) => {
    const combat = soldiers.get(body.uid)?.combat;
    const target = combat?.siege === undefined ? undefined : building(combat.siege);
    if (combat?.marchSpeed !== undefined && target &&
      distanceBetween(body, target.workerApproach) <= INDEPENDENT_APPROACH_DISTANCE) combat.marchSpeed = undefined;
    const exchange = [...exchanges.values()].find(entry => entry.attacker === body.uid || entry.defender === body.uid);
    if (body.phase !== "militarySiege" || !exchange) {
      const state = soldiers.get(body.uid)?.combat;
      const site = state?.siege === undefined ? undefined : building(state.siege);
      if (!site || site.militaryFaction === undefined || body.phase !== "militaryField" || body.mounted) return false;
      if (battle.engaged(body, state!)) return false;
      // An undefended fort under direct assault, or an open scaffold (its archers never come down
      // to a door): the field behaviour strikes its walls.
      if (doors.get(site.uid)?.structure && (isOpenArcherTower(site) || !defenders(site.uid).length)) return false;
      // Flank places end with their door fight (the defender fell or went back inside this tick).
      if (exchanges.has(site.uid) && helpers.get(site.uid)?.includes(body.uid)) {
        helpAtDoor(body, soldiers.get(body.uid)!, site, dt);
        return true;
      }
      const waiting = [...soldiers.values()].filter(entry => entry.combat?.siege === site.uid && onFoot(entry))
        .sort((a, b) => a.actor - b.actor);
      // One soldier goes ahead: a melee soldier while the door stands (archers cannot bash it).
      const basher = nearestBasher(site, waiting) ?? (!doors.get(site.uid)?.hp
        ? [...waiting].sort((a, b) => doorDistance(site, a) - doorDistance(site, b) || a.actor - b.actor)[0]
        : undefined);
      if (!exchanges.has(site.uid) && basher?.actor === body.uid) return false;
      queue.walkTo(body, queue.queuePlace(site, body), dt, site);
      return true;
    }
    const site = building(exchange.building), soldier = soldiers.get(body.uid);
    if (!site || !soldier) return true;
    if (exchange.stage === "duel") {
      const opponent = soldiers.get(body.uid === exchange.attacker ? exchange.defender! : exchange.attacker);
      if (opponent) strike(body, soldier, opponent, dt);
      return true;
    }
    // The attacker walks up to the door through its comrades' queue like any field soldier; the
    // door lane itself (defender out, capture, return) keeps the exact worker walk.
    const steered = exchange.stage === "approach" && body.uid === exchange.attacker;
    if (!(steered ? battle.steer(body, dt) : moveActor(context, body, dt))) return true;
    body.action = "idle";
    if (exchange.stage === "return" && body.uid === exchange.defender) {
      body.phase = "garrison"; body.visible = false; soldier.stationed = true;
      exchanges.delete(site.uid);
    } else if (exchange.stage === "capture" && body.uid === exchange.attacker) {
      if (defenders(site.uid).length || DMath.hypot(body.x - site.doorThreshold.x, body.z - site.doorThreshold.z) > .08) return true;
      // A computer economy's building has no door until its first assault (EAI1b E5): capture never assumes one.
      const door = doors.get(site.uid);
      if (door) door.faction = soldier.combat!.faction;
      site.militaryFaction = soldier.combat!.faction;
      soldier.building = site.uid; soldier.stationed = true; soldier.combat!.siege = undefined;
      body.phase = "garrison"; body.visible = false; site.door = 1;
      exchanges.delete(site.uid);
      for (const other of soldiers.values()) if (other.combat?.siege === site.uid) {
        other.combat.siege = undefined;
        const survivor = actor(other.actor);
        // The doorway exchange has ended. Do not strand a former attacker in its private phase.
        if (!other.stationed && survivor?.phase === "militarySiege") {
          survivor.phase = "militaryField"; survivor.path = []; survivor.pathIndex = 0;
          survivor.action = "idle";
        }
      }
    } else if (exchange.stage === "approach") {
      const attacker = actor(exchange.attacker), defender = actor(exchange.defender!);
      if (attacker && defender && !soldiers.get(exchange.defender!)?.stationed && duelReady(attacker, defender)) {
        // Soldiers held off their stances by each other fight from where they stand.
        attacker.pathIndex = attacker.path.length; defender.pathIndex = defender.path.length;
        exchange.stage = "duel";
        soldiers.get(exchange.attacker)!.combat!.cooldown = 0;
        soldiers.get(exchange.defender!)!.combat!.cooldown = 0;
      }
    }
    return true;
  };
  const garrisonSite = { actor, building, doors, exchanges, soldiers };
  /** `structure`: walls attacked directly once the garrison is dead (colony forts; never captured). */
  const registerGarrison = (uid: number, ids: readonly number[], faction: number, hp = 200,
    structure?: MilitaryStructure) => registerSiegeGarrison(garrisonSite, uid, ids, faction, hp, structure);
  return { update, updateActor, cancel, registerGarrison,
    rejoinGarrison: (id: number, uid: number) => rejoinSiegeGarrison(garrisonSite, id, uid),
    onDeath: (id: number) => {
      for (const exchange of Array.from(exchanges.values())) {
        if (exchange.attacker === id && !promoteHelper(exchange)) returnDefender(exchange);
        else if (exchange.defender === id) {
          const body = actor(exchange.attacker), site = building(exchange.building);
          lowerWeapons(exchange);
          if (body && site) setActorPath(body, [site.access], "militaryLeaving");
          exchanges.delete(exchange.building);
        }
      }
    },
    active: (id: number) => [...exchanges.values()].some(entry => entry.attacker === id || entry.defender === id),
    /** A live doorway exchange (approach or duel) keeps this building's garrison out of recovery. */
    inCombat: (uid: number) => exchanges.has(uid),
    /** A garrison soldier out at its door, defending it. */
    isDefender: (id: number) => [...exchanges.values()].some(entry => entry.defender === id),
    /** In a door fight: duelling, or striking from a flank. */
    atDoor: (id: number) => [...exchanges.values()].some(entry => entry.attacker === id || entry.defender === id) ||
      [...helpers.values()].some(ids => ids.includes(id)),
    /**
     * Whether a rider dismounting at `body` would get one of the door's fighting places: a defender
     * is left, and fewer foot attackers than places stand nearer the door.
     */
    hasDoorSlot: (uid: number, body: SettlementActor) => {
      const site = building(uid), exchange = exchanges.get(uid);
      if (!site || !defenders(uid).length || exchange?.stage === "return") return false;
      const places = Math.min(MAX_DOOR_ATTACKERS, 1 + siteSlots(site).flanks.length);
      const reach = distanceBetween(body, site.access);
      let ahead = 0;
      for (const soldier of soldiers.values()) {
        const other = actor(soldier.actor);
        if (soldier.combat?.siege !== uid || fightingType(soldier.combat) === "archer" || !other || other.mounted ||
          other === body) continue;
        if (other.phase === "militarySiege" || distanceBetween(other, site.access) <= reach) ahead++;
      }
      return ahead < places;
    },
    save: () => [...exchanges.values()].map(entry => ({ ...entry })),
    restore: (saved: readonly MilitaryDoorExchange[] = []) => {
      exchanges.clear(); helpers.clear(); queue.clear(); approaches.clear();
      for (const entry of saved) exchanges.set(entry.building, { ...entry });
    },
    /** Approach watches, flank helpers and the door queue (after `restore`). */
    saveField: (): SiegeFieldSave =>
      ({ approaches: saveEntries(approaches), helpers: saveEntries(helpers), queue: queue.save() }),
    restoreField: (saved: Partial<SiegeFieldSave> | undefined) => {
      restoreEntries(approaches, saved?.approaches);
      restoreEntries(helpers, saved?.helpers);
      queue.restore(saved?.queue);
    },
    removeBuilding: (uid: number) => {
      forgetSite(uid); helpers.delete(uid); approaches.delete(uid);
      const exchange = exchanges.get(uid);
      if (exchange) releaseAttacker(exchange);
      exchanges.delete(uid); doors.delete(uid);
    }
  };
};
