import { CIVILIAN_HP, MILITARY_PROFILES } from "../balance/military";
import { deterministicPow, DMath } from "../math/deterministic-math";
import { emitUnitDamaged, emitUnitKilled, unitSource } from "../script-world/script-unit-events";
import { probeAccept } from "./faction-vision-probe";
import { isExposedPerson, releaseCrew, ROOF_PORTER_PHASE } from "./military-civilian-crews";
import {
  fightingType, type MilitaryCombatant, type MilitaryDeathEffect, type MilitaryTroopType
} from "./military-combat-rules";
import { createMilitarySpatialGrid } from "./military-spatial-grid";
import { acquireRadius, leashRadius, type MilitaryStance } from "./military-targeting";
import { releaseCorridor } from "./settlement-corridor-reservations";
import { leaveStorageArrival } from "./settlement-door-traffic";
import { updatePersonTraffic } from "./settlement-person-index";
import { releasePersonWork } from "./settlement-person-release";
import { retirePerson } from "./settlement-population";
import { clearWareTransfer } from "./settlement-stock-transfers";
import { clearTrafficBlocker } from "./settlement-traffic-deadlock";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Computer archers spare a short opportunistic shot at a civilian (MIL-ASSAULT 2026-11-08): the
 * full 8-tile bow range stays reserved for soldiers and the shot still respects the archer's 2-tile
 * minimum range. Matching the 6-tile march acquisition radius keeps a nearby civilian worth
 * noticing, never a battle objective of its own.
 */
export const CIVILIAN_ARCHER_RANGE = 6;

/** A civilian outside a building who has taken blows: the hit points left. */
export interface WoundedCivilian { actor: number; hp: number }

/** The combat save fields of the civilian targets; both are absent while nothing happened. */
export interface CivilianTargetSave {
  /** Player civilians killed by enemies (offline catch-up sees every casualty as a fight). */
  civilianDeaths?: number;
  woundedCivilians?: WoundedCivilian[];
}

export interface CivilianHuntRouting {
  /** One retreat step away from `from`; the tiles walked (0: no way back). */
  backAway: (actor: SettlementActor, state: MilitaryCombatant, from: SettlementActor, dt: number) => number;
  plan: (actor: SettlementActor, state: MilitaryCombatant, point: SettlementPoint) => unknown;
  stand: (actor: SettlementActor) => void;
  walk: (actor: SettlementActor, dt: number) => void;
}

/** Where a soldier looks for civilians: its stance, and the post or camp it may not stray from. */
export interface CivilianHuntPost { anchor?: SettlementPoint; stance: MilitaryStance }

/**
 * Every player civilian outside a building is an enemy target (owner 2026-11-09): seen in the world,
 * on land, and not a soldier or the commander. Since MIL-CREWS this includes cart crews, horse leaders,
 * boat crews, voyage helpers still on land and Catapult roof porters (military-civilian-crews.ts).
 */
export const isAttackableCivilian = (actor: SettlementActor, isSoldier: (uid: number) => boolean) =>
  isExposedPerson(actor) && !isSoldier(actor.uid);

/** Melee soldiers cannot climb a Catapult Tower: its roof porter is a target for arrows only. */
const withinReachOf = (type: MilitaryTroopType, prey: SettlementActor) =>
  type === "archer" || prey.phase !== ROOF_PORTER_PHASE;

/** Saved wounds: unique living civilians with hit points in range; a positive casualty count. */
export const civilianTargetError = (saved: CivilianTargetSave, civilians: ReadonlySet<number>) => {
  const deaths = saved.civilianDeaths;
  if (deaths !== undefined && (!Number.isSafeInteger(deaths) || deaths <= 0)) return true;
  const wounded = saved.woundedCivilians;
  if (wounded === undefined) return false;
  if (!Array.isArray(wounded)) return true;
  const seen = new Set<number>();
  for (const entry of wounded) {
    if (!entry || !civilians.has(entry.actor) || seen.has(entry.actor) || !Number.isFinite(entry.hp) ||
      entry.hp <= 0 || entry.hp >= CIVILIAN_HP) return true;
    seen.add(entry.actor);
  }
  return false;
};

/** How far a soldier in `stance` looks for civilians: its acquire radius, archers only a short shot. */
const huntRadius = (stance: MilitaryStance, type: MilitaryTroopType) => type === "archer"
  ? Math.min(acquireRadius(stance, type), CIVILIAN_ARCHER_RANGE) : acquireRadius(stance, type);

const blowDamage = (type: MilitaryTroopType, rank: number) =>
  MILITARY_PROFILES[type].damage * deterministicPow(1.2, rank);

/**
 * The person dies where it stands: its work and claims are released (its workplace hires again),
 * and the goods in its hands and its tool are lost. A crew's cart stops where it stands, a led horse
 * is let go and voyages forget the person (military-civilian-crews.ts).
 */
const killCivilian = (context: SettlementContext, body: SettlementActor) => {
  releaseCrew(context, body, false);
  leaveStorageArrival(context, body);
  releasePersonWork(context, body);
  clearWareTransfer(body);
  releaseCorridor(context, body.uid);
  clearTrafficBlocker(body);
  Object.assign(body, { action: "idle", catapultEvacuation: undefined, catapultStoneCargo: undefined,
    demolitionCargo: undefined, demolitionReturning: false, path: [], pathIndex: 0, queueTarget: undefined,
    tool: undefined, ware: null, wareUnits: undefined });
  retirePerson(context, body, false);
  body.visible = false;
  updatePersonTraffic(context, body);
  context.actors.splice(context.actors.indexOf(body), 1);
};

/**
 * Player civilians outside buildings as enemy targets (owner 2026-11-09): computer soldiers with no
 * soldier to fight hunt them within their acquire radius, melee soldiers strike, archers shoot. A
 * civilian has `CIVILIAN_HP`; the wound heals once it enters a building. Candidates sit in a spatial
 * grid built at most once per tick, and only when a computer soldier or an arrow asks for one.
 */
export const createCivilianTargets = (
  context: SettlementContext, actorById: (id: number) => SettlementActor | undefined,
  isSoldier: (uid: number) => boolean, onDeath: (effect: MilitaryDeathEffect) => void
) => {
  const wounded = new Map<number, number>();
  const { cellsX, cellsZ } = context.options.world;
  const grid = createMilitarySpatialGrid<SettlementActor>(cellsX, cellsZ);
  const candidates: SettlementActor[] = [];
  let gridFresh = false, deaths = 0;
  const attackable = (body: SettlementActor) => isAttackableCivilian(body, isSoldier);
  const targetById = (uid: number) => {
    const body = actorById(uid);
    return body && attackable(body) ? body : undefined;
  };
  /** Builds this tick's candidate grid on first use; false when no civilian is outside. */
  const ensureGrid = () => {
    if (gridFresh) return candidates.length > 0;
    gridFresh = true;
    candidates.length = 0;
    for (const actor of context.actors) if (attackable(actor)) candidates.push(actor);
    grid.rebuild(candidates);
    return candidates.length > 0;
  };
  const nearest = (from: SettlementActor, radius: number, post: CivilianHuntPost, type: MilitaryTroopType) => {
    if (radius <= 0 || !ensureGrid()) return undefined;
    const { anchor, stance } = post, leash = leashRadius(stance, type);
    // Only civilians the hunter's faction sees (A13 phase 3).
    const faction = context.military?.factionOf?.(from.uid) ?? 1, knowledge = context.factionKnowledge;
    const accept = (prey: SettlementActor) => attackable(prey) && withinReachOf(type, prey) &&
      (!anchor || DMath.hypot(prey.x - anchor.x, prey.z - anchor.z) <= leash) &&
      knowledge?.knows(faction, prey) !== false;
    const body = grid.nearest(from.x, from.z, radius, probeAccept("raider.civilianHunt", faction, accept));
    return body && { body, distance: DMath.hypot(body.x - from.x, body.z - from.z) };
  };
  const wound = (body: SettlementActor, damage: number, attacker: SettlementActor | undefined) => {
    if (context.script?.isInvulnerable(body.uid)) return;
    const before = wounded.get(body.uid) ?? CIVILIAN_HP, hp = before - damage;
    const source = context.script && unitSource(attacker);
    if (context.script)
      emitUnitDamaged(context, body, source, { after: Math.max(0, hp), before, maximum: CIVILIAN_HP });
    if (hp > 0) { wounded.set(body.uid, hp); return; }
    wounded.delete(body.uid);
    deaths++;
    onDeath({ age: 0, faction: 0, id: body.uid, x: body.x, y: body.y, z: body.z });
    if (context.script) emitUnitKilled(context, body, source);
    killCivilian(context, body);
  };
  const strike = (actor: SettlementActor, state: MilitaryCombatant, rank: number, prey: SettlementActor,
    routing: CivilianHuntRouting) => {
    routing.stand(actor);
    actor.yaw = DMath.atan2(prey.x - actor.x, prey.z - actor.z);
    if (state.cooldown) return;
    const type = fightingType(state);
    state.cooldown = MILITARY_PROFILES[type].interval; state.attackTime = .6; actor.animationTime = 0;
    wound(prey, blowDamage(type, rank), actor);
  };
  /**
   * An archer's civilian hunt: only civilians inside the short civilian range are noticed. One
   * inside the bow's minimum range makes the archer back away first (kiting, owner 2026-11-09); the
   * draw is armed like any other shot and the field's release step looses the actual arrow.
   */
  const huntWithBow = (actor: SettlementActor, state: MilitaryCombatant, post: CivilianHuntPost, dt: number,
    routing: CivilianHuntRouting) => {
    const prey = nearest(actor, huntRadius(post.stance, "archer"), post, "archer");
    if (!prey) return false;
    if (prey.distance < MILITARY_PROFILES.archer.minimumRange)
      return routing.backAway(actor, state, prey.body, dt) > 1e-8;
    routing.stand(actor);
    actor.yaw = DMath.atan2(prey.body.x - actor.x, prey.body.z - actor.z);
    if (state.cooldown) return true;
    state.cooldown = MILITARY_PROFILES.archer.interval;
    state.attackTime = .6;
    state.pendingTarget = prey.body.uid;
    return true;
  };
  return {
    /** A new tick: the grid is rebuilt on first use; civilians indoors (or gone) are whole again. */
    update: () => {
      gridFresh = false;
      for (const uid of [...wounded.keys()]) if (!targetById(uid)) wounded.delete(uid);
    },
    /**
     * A computer soldier with no soldier target and no siege goes for the nearest civilian within its
     * acquire radius (and its post's leash): melee soldiers close in and strike, archers loose a short
     * shot. False when there is none (the soldier carries on as before).
     */
    hunt: (actor: SettlementActor, state: MilitaryCombatant, rank: number, post: CivilianHuntPost, dt: number,
      routing: CivilianHuntRouting) => {
      // Soldiers come first: only a soldier with no soldier target hunts civilians (owner 2026-11-08).
      if (state.faction <= 0 || state.siege !== undefined || state.target !== undefined) return false;
      const type = fightingType(state);
      if (type === "archer") return huntWithBow(actor, state, post, dt, routing);
      const prey = nearest(actor, huntRadius(post.stance, type), post, type);
      if (!prey) return false;
      if (prey.distance <= MILITARY_PROFILES[type].range) {
        strike(actor, state, rank, prey.body, routing);
        return true;
      }
      routing.plan(actor, state, prey.body);
      routing.walk(actor, dt);
      return true;
    },
    /** Whether a computer soldier would find a civilian to hunt (same radius and leash as `hunt`). */
    inReach: (actor: SettlementActor, state: MilitaryCombatant, post: CivilianHuntPost) => {
      const type = fightingType(state);
      return nearest(actor, huntRadius(post.stance, type), post, type) !== undefined;
    },
    isTarget: (uid: number) => targetById(uid) !== undefined,
    /** Civilians within `radius` of any of the points (the arrows in flight), in grid order. */
    near: (points: readonly SettlementPoint[], radius: number) => {
      const found = new Set<SettlementActor>();
      if (!points.length || !ensureGrid()) return found;
      for (const point of points) grid.forEachWithin(point.x, point.z, radius, attackable, body => found.add(body));
      return found;
    },
    /** An arrow's hit: the same blow damage as a melee strike, so the 30 HP rule is shared. */
    wound: (id: number, type: MilitaryTroopType, rank: number, shooter?: number) => {
      const body = targetById(id);
      if (!body) return;
      const attacker = context.script && shooter !== undefined ? actorById(shooter) : undefined;
      wound(body, blowDamage(type, rank), attacker);
    },
    hitPoints: (uid: number) => wounded.get(uid) ?? CIVILIAN_HP,
    deaths: () => deaths,
    /** Wounded civilians (an open fight the quiet-island skip must not jump over). */
    size: () => wounded.size,
    /** Absent fields while nobody was hurt keep saves of untouched games identical. */
    save: (): CivilianTargetSave => ({
      ...(deaths ? { civilianDeaths: deaths } : {}),
      ...(wounded.size ? { woundedCivilians: [...wounded].map(([actor, hp]) => ({ actor, hp })) } : {})
    }),
    restore: (saved: CivilianTargetSave = {}) => {
      wounded.clear();
      deaths = saved.civilianDeaths ?? 0;
      for (const entry of saved.woundedCivilians ?? []) wounded.set(entry.actor, entry.hp);
      gridFresh = false;
    }
  };
};

export type CivilianTargets = ReturnType<typeof createCivilianTargets>;
