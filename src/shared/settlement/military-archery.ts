import { MILITARY_PROFILES } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { courtyardProjectileWalls } from "./event-courtyard";
import { militaryBowOrigin, militaryManualBowOrigin } from "./military-bow-origin";
import { fireCatapultTowers, sweepCatapultBoulder } from "./military-catapult";
import { type CatapultImpactTarget, resolveCatapultImpact } from "./military-catapult-impact";
import { isRollingBoulder, rollCatapultBoulder } from "./military-catapult-roll";
import type { CivilianTargets } from "./military-civilian-targets";
import { ARROW_SPEED, type MilitaryArrow,shootMilitaryArrow, sweepMilitaryArrow } from "./military-projectiles";
import { createMilitarySpatialGrid } from "./military-spatial-grid";
import {
type ExposedGarrisonArcher,
  exposedGarrisonArchers, garrisonArcherTarget} from "./settlement-garrison-archers";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import type { AuditedRandom } from "./simulation-random";

/** Bow hand ahead of a standing archer's chest. */
const BOW_REACH = .3;
/**
 * Civilians this close (tiles) to an enemy arrow join this tick's arrow targets: one tick of flight
 * (half a tile), the body's hit radius and a margin. Far civilians never enter the contact loop.
 */
const CIVILIAN_ARROW_REACH = 1;

type Hit = (attacker: SettlementSoldier, defender: SettlementSoldier, full: boolean, pointBlank?: boolean,
  multiplier?: number, archerPost?: boolean, instantKill?: boolean, fixedDamage?: number) => void;
/** An arrow shot at a building's walls stopped at `point`. */
/** `point` is the stopped arrow; its faction decides the siege talent. */
type WallHit = (wall: number, rank: number, point: SettlementPoint & { faction?: number }) => void;
interface ArcherySave { arrows: MilitaryArrow[]; nextArrow: number }
const copyBoulder = (boulder: NonNullable<MilitaryArrow["boulder"]>) => boulder.roll
  ? { ...boulder, roll: { ...boulder.roll, touched: [...boulder.roll.touched] } }
  : { ...boulder };
const copyArrow = (arrow: MilitaryArrow): MilitaryArrow =>
  ({ ...arrow, ...(arrow.boulder ? { boulder: copyBoulder(arrow.boulder) } : {}) });

/**
 * Bows of the battle: field archers' shots, garrison archers on tower posts and at windows (they
 * shoot and can be shot), and every arrow in flight until it hits or stops.
 */
export const createMilitaryArchery = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, random: AuditedRandom,
  actorById: (id: number) => SettlementActor | undefined,
  isBuildingStanding: (uid: number) => boolean = () => true,
  civilians?: CivilianTargets
) => {
  const arrows: MilitaryArrow[] = [];
  const impactTargets = createMilitarySpatialGrid<CatapultImpactTarget>(context.options.world.cellsX, context.options.world.cellsZ);
  let nextArrow = 0;
  /** Archers on tower posts and at windows this tick: they shoot, and can be shot. */
  let exposed = new Map<number, ExposedGarrisonArcher>();
  /** The field soldiers among this tick's bodies; reused instead of allocating a filtered copy. */
  const fieldBodies: SettlementActor[] = [];
  /** Where a soldier can be hit: its exposed garrison figure, or its own body in the field. */
  const targetBody = (id: number) => {
    const actor = actorById(id), seen = exposed.get(id);
    return actor && seen ? { ...actor, x: seen.body.x, y: seen.body.y, z: seen.body.z } : actor;
  };
  const leadOf = (target: SettlementActor) => {
    const speed = target.action === "walk" ? target.locomotionSpeed ?? .9 : 0;
    return { x: DMath.sin(target.yaw) * speed, z: DMath.cos(target.yaw) * speed };
  };
  /** A field archer looses an arrow at a body from its bow hand. */
  const looseAt = (soldier: SettlementSoldier, actor: SettlementActor, enemy: SettlementActor) => {
    arrows.push({ id: nextArrow++, shooter: actor.uid, faction: soldier.combat!.faction, rank: soldier.rank,
      ...shootMilitaryArrow(militaryBowOrigin(actor), { ...enemy, y: enemy.y + .62 }, leadOf(enemy), soldier.rank,
        random.at("archery.fieldShot", actor.uid)) });
  };
  /** A field archer looses an arrow at `target` from its bow hand. */
  const fire = (soldier: SettlementSoldier, target: SettlementSoldier, actor: SettlementActor) =>
    looseAt(soldier, actor, targetBody(target.actor)!);
  /** A field archer looses an arrow at a civilian outside a building (MIL-ASSAULT 2026-11-08). */
  const fireAtCivilian = (soldier: SettlementSoldier, target: SettlementActor, actor: SettlementActor) =>
    looseAt(soldier, actor, target);
  /** A field archer looses an arrow at a point on the walls of building `wall`. */
  const fireAtWall = (soldier: SettlementSoldier, actor: SettlementActor, target: SettlementPoint & { y: number },
    wall: number) => {
    arrows.push({ id: nextArrow++, shooter: actor.uid, faction: soldier.combat!.faction, rank: soldier.rank, wall,
      ...shootMilitaryArrow(militaryBowOrigin(actor), target, { x: 0, z: 0 }, soldier.rank,
        random.at("archery.wallShot", actor.uid)) });
  };
  /** Untargeted manual shot shares the actual allocator, seeded aim, projectile custody and casualty sink. */
  const fireAtPoint = (soldier: SettlementSoldier, actor: SettlementActor, target: SettlementPoint & { y: number },
    pitch: number) => {
    const origin = militaryManualBowOrigin(actor, pitch);
    arrows.push({ id: nextArrow++, shooter: actor.uid, faction: soldier.combat!.faction, rank: soldier.rank,
      maximumAge: Math.max(.15, DMath.hypot(target.x - origin.x, target.z - origin.z) / ARROW_SPEED),
      ...shootMilitaryArrow(origin, target, { x: 0, z: 0 }, soldier.rank,
        random.at("archery.fieldShot", actor.uid)) });
  };
  const releaseGarrisonArrow = (archer: ExposedGarrisonArcher, target: SettlementActor) => {
    const state = archer.soldier.combat!;
    // A post archer's bow is held out towards the target, a little in front of the body.
    const aim = DMath.atan2(target.x - archer.origin.x, target.z - archer.origin.z);
    const reach = archer.facing === null ? BOW_REACH : 0;
    const origin = { ...archer.origin, x: archer.origin.x + DMath.sin(aim) * reach,
      z: archer.origin.z + DMath.cos(aim) * reach };
    arrows.push({ id: nextArrow++, shooter: archer.soldier.actor, faction: state.faction, rank: archer.soldier.rank,
      building: archer.building,
      damageMultiplier: state.faction > 0 && archer.facing === null && context.options.homeBuilding === 39 ? 1.5 : 1,
      ...shootMilitaryArrow(origin, { ...target, y: target.y + .62 }, leadOf(target), archer.soldier.rank,
        random.at("archery.garrisonShot", archer.soldier.actor)) });
  };
  /** Garrison archers shoot from their post (all around) or window (its cone only). */
  /** A13 phase 3: garrison archers aim only at enemies their faction knows (or any, under the sight rule). */
  const knowsEnemy = (faction: number, enemy: SettlementActor) =>
    context.factionKnowledge?.troopKnows(faction, enemy) !== false;
  const fireFromGarrisons = (dt: number, field: readonly SettlementActor[]) => {
    if (!exposed.size) return;
    const enemies = field.flatMap(body => {
      const soldier = soldiers.get(body.uid);
      return soldier ? [{ ...body, soldier }] : [];
    });
    for (const archer of exposed.values()) {
      const state = archer.soldier.combat!;
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.attackTime = Math.max(0, (state.attackTime ?? 0) - dt);
      // Like field archers, the arrow leaves the bow only once the draw is nearly complete.
      if (state.pendingTarget !== undefined && state.attackTime <= .15) {
        const target = enemies.find(enemy => enemy.uid === state.pendingTarget && soldiers.has(enemy.uid));
        state.pendingTarget = undefined;
        if (target) releaseGarrisonArrow(archer, target);
      }
      if (state.cooldown || state.pendingTarget !== undefined) continue;
      const target = garrisonArcherTarget(archer, enemies, knowsEnemy);
      if (!target) continue;
      // The draw animation plays on the archer seen at its post or window.
      state.cooldown = MILITARY_PROFILES.archer.interval; state.attackTime = .6;
      state.pendingTarget = target.uid;
    }
  };
  /** Civilians an enemy arrow could reach this tick (computer arrows only; boulders never hit them). */
  const civiliansNearEnemyArrows = () => {
    if (!civilians) return [];
    const flying = arrows.filter(arrow => arrow.faction > 0 && !arrow.boulder);
    return flying.length ? [...civilians.near(flying, CIVILIAN_ARROW_REACH)] : [];
  };
  /** Moves every arrow; a contact hurts an enemy (arrows fly through friends). */
  const sweepArrows = (dt: number, field: readonly SettlementActor[], hit: Hit, wallHit?: WallHit) => {
    if (!arrows.length) return;
    const targets = [...field.map(body => body.uid), ...exposed.keys()].flatMap(id => {
      const body = targetBody(id), faction = soldiers.get(id)?.combat?.faction;
      return body && faction !== undefined ? [{ ...body, faction, id }] : [];
    });
    // Civilians outside buildings are enemy targets too (they are on the player's side), near enemy arrows only.
    for (const body of civiliansNearEnemyArrows()) targets.push({ ...body, faction: 0, id: body.uid });
    if (arrows.some(arrow => arrow.boulder)) {
      // Bow targeting intentionally excludes door defenders; an area impact includes every visible enemy body.
      const ids = new Set([...context.actors.filter(body => body.visible).map(body => body.uid), ...exposed.keys()]);
      impactTargets.rebuild([...ids].flatMap(id => {
        const body = targetBody(id), state = soldiers.get(id)?.combat;
        return body && state && state.hp > 0 ? [{ ...body, faction: state.faction, id }] : [];
      }));
    }
    const built = context.buildings.filter(building => building.construction === 1);
    const walls = built.some(building => building.eventCourtyard) ?
      built.flatMap(building => building.eventCourtyard ? courtyardProjectileWalls(building) : [building]) : built;
    const rolling = arrows.some(isRollingBoulder) ? { hit, soldiers, targets: impactTargets } : undefined;
    for (let index = arrows.length - 1; index >= 0; index--) {
      const arrow = arrows[index]!;
      if (rolling && isRollingBoulder(arrow)) { rollCatapultBoulder(context, arrow, dt, rolling); continue; }
      const contact = arrow.boulder
        ? sweepCatapultBoulder(arrow, dt)
        : sweepMilitaryArrow(arrow, dt, context.options.world, targets, walls);
      if (arrow.boulder) {
        if (contact.stopped) resolveCatapultImpact(context, arrow, impactTargets, soldiers, hit);
        if ((contact as { removed?: boolean }).removed) arrows.splice(index, 1);
        continue;
      }
      if (contact.target !== undefined) {
        const defender = soldiers.get(contact.target);
        // An arrow already released remains dangerous even if its shooter dies.
        const attacker = soldiers.get(arrow.shooter) ?? { actor: arrow.shooter, rank: arrow.rank,
          stationed: false, building: -3, combat: { type: "archer", faction: arrow.faction, hp: 1, cooldown: 0 } };
        // Arrows loosed from a garrison post or window carry their building: tower archery.
        if (defender) hit(attacker, defender, Boolean(contact.full), false, arrow.damageMultiplier ?? 1,
          arrow.building !== undefined, Boolean(arrow.boulder));
        // A civilian is not a soldier: its 30 HP pool takes the bow's blow damage.
        else if (civilians) civilians.wound(contact.target, "archer", arrow.rank, arrow.shooter);
        // A wounded civilian stays a target; a killed one or a departed garrison body drops out.
        if (!soldiers.has(contact.target) && !civilians?.isTarget(contact.target)) {
          const removed = targets.findIndex(target => target.id === contact.target);
          if (removed >= 0) targets.splice(removed, 1);
        }
      }
      if (!contact.stopped) continue;
      if (contact.target === undefined && arrow.wall !== undefined) wallHit?.(arrow.wall, arrow.rank, arrow);
      arrows.splice(index, 1);
    }
  };
  return {
    arrows: () => arrows,
    fire,
    fireAtCivilian,
    fireAtWall,
    fireAtPoint,
    isExposed: (id: number) => exposed.has(id),
    /** Enemy archers on posts and at windows within `radius` of `from`. */
    forEachExposed: (from: SettlementPoint, radius: number, faction: number, visit: (id: number) => void) => {
      for (const [id, archer] of exposed) {
        if (archer.soldier.combat?.faction === faction) continue;
        if (DMath.hypot(archer.body.x - from.x, archer.body.z - from.z) <= radius) visit(id);
      }
    },
    targetBody,
    /**
     * `bodies`: this tick's field soldiers and door duellists of every side. Garrison archers shoot
     * field soldiers only; arrows hit any of them (a door defender too).
     */
    update: (dt: number, bodies: readonly SettlementActor[], hit: Hit, wallHit?: WallHit) => {
      exposed = new Map(exposedGarrisonArchers(context, soldiers).map(entry => [entry.soldier.actor, entry]));
      fieldBodies.length = 0;
      for (const body of bodies) if (body.phase === "militaryField") fieldBodies.push(body);
      fireFromGarrisons(dt, fieldBodies);
      fireCatapultTowers(context, soldiers, bodies, dt, arrow => arrows.push({ ...arrow, id: nextArrow++ }),
        isBuildingStanding, random.at("military.catapult", 0));
      sweepArrows(dt, bodies, hit, wallHit);
    },
    save: (): ArcherySave => ({ arrows: arrows.map(copyArrow), nextArrow }),
    restore: (saved?: ArcherySave) => {
      arrows.splice(0, arrows.length, ...(saved?.arrows ?? []).map(copyArrow));
      nextArrow = saved?.nextArrow ?? 0;
    }
  };
};
