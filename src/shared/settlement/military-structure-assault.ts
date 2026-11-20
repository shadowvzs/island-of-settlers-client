import { isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { MILITARY_PROFILES } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { emitBuildingDamaged, emitBuildingDestroyed } from "../script-world/script-building-events";
import { unitSource } from "../script-world/script-unit-events";
import { burnsDownWhenFallen } from "./building-destruction";
import {
  courtyardAssaultSite,
  releaseCourtyardDefenders,
  strikeCourtyardWall
} from "./event-courtyard";
import { probeUnitRead } from "./faction-vision-probe";
import { FORT_REMOVAL_SECONDS, structureDamage } from "./fort-assault-rules";
import { fightingType, type MilitaryCombatant, type MilitaryDoor } from "./military-combat-rules";
import { restoreEntries, type SavedEntries,saveEntries } from "./military-field-save";
import { fortifyPlayerSite, isPlayerSiegeDoor, plotDistance } from "./military-siege-sites";
import { releaseTowerArchers } from "./military-tower-collapse";
import { reachableCells } from "./settlement-colony";
import {
  buildingFootprint,
  type ExposedGarrisonArcher,
  footprintDistance,
  structureAttackFootprint} from "./settlement-garrison-archers";
import type { SettlementSoldier } from "./settlement-military";
import { releaseFallenSiteSoldiers, releaseRemovedSiteSoldiers } from "./settlement-military-site-removal";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import { leavesRuin, removeFallenBuilding } from "./settlement-ruin-fall";
import { siegeTalentFactor } from "./settlement-talents";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementPoint
} from "./settlement-types";
import type { AuditedRandom } from "./simulation-random";

type Footprint = ExposedGarrisonArcher["footprint"];
/** Spacing (tiles) of the attack places around a building's walls. */
const SLOT_SPACING = 0.75;
/** Foot soldiers stand this far outside the plot, riders a horse's length. */
const SLOT_OFFSETS = { foot: 0.45, rider: 1.1 } as const;
type SlotKind = keyof typeof SLOT_OFFSETS | "archer";
/**
 * Archers stand on rings this far outside the walls they shoot (the visible hall, not the plot),
 * the middle of their wall-shooting band first; the outer rings give cramped forts more places.
 */
const ARCHER_RING_OFFSETS = [4.5, 3.5, 5.5] as const;
/** Archers shoot the walls from up to this share of their bow range. */
const ARCHER_REACH_SHARE = 0.75;
/** Archer places keep this margin inside their wall-shooting band (jostling, rounding). */
const ARCHER_BAND_MARGIN = 0.2;
/** An arrow that stops this close to the target's plot struck its walls. */
const ARROW_WALL_MARGIN = 0.6;
/**
 * A player soldier in the field this close to a player building's plot (tiles) defends it: its
 * walls are not struck until that soldier is beaten (raider priority, owner 2026-11-08).
 */
const FIELD_DEFENCE_REACH = 4;

interface AssaultDeps {
  actorById: (id: number) => SettlementActor | undefined;
  doors: Map<number, MilitaryDoor>;
  /** Looses a bow at a point on the walls; the arrow carries the building id. */
  fireAtWall: (
    soldier: SettlementSoldier,
    actor: SettlementActor,
    target: SettlementPoint & { y: number },
    building: number
  ) => void;
  plan: (actor: SettlementActor, state: MilitaryCombatant, point: SettlementPoint) => void;
  random: AuditedRandom;
  soldiers: Map<number, SettlementSoldier>;
  stand: (actor: SettlementActor) => void;
  walk: (actor: SettlementActor, dt: number) => void;
}

/** Points on a ring `offset` tiles outside a footprint, every `SLOT_SPACING` along its edge. */
const ringAround = (site: Footprint, offset: number) => {
  const halfWidth = site.halfWidth + offset,
    halfDepth = site.halfDepth + offset;
  const sides: Array<[SettlementPoint, SettlementPoint]> = [
    [
      { x: -halfWidth, z: -halfDepth },
      { x: halfWidth, z: -halfDepth }
    ],
    [
      { x: halfWidth, z: -halfDepth },
      { x: halfWidth, z: halfDepth }
    ],
    [
      { x: halfWidth, z: halfDepth },
      { x: -halfWidth, z: halfDepth }
    ],
    [
      { x: -halfWidth, z: halfDepth },
      { x: -halfWidth, z: -halfDepth }
    ]
  ];
  return sides.flatMap(([from, to]) => {
    const length = DMath.hypot(to.x - from.x, to.z - from.z),
      count = Math.max(1, Math.floor(length / SLOT_SPACING));
    return Array.from({ length: count }, (_, index) => ({
      x: site.x + from.x + ((to.x - from.x) * index) / count,
      z: site.z + from.z + ((to.z - from.z) * index) / count
    }));
  });
};

/** Whether an archer here can shoot the walls of `footprint` (bow range, outside the dead zone). */
const inArcherBand = (footprint: Footprint, point: SettlementPoint, margin = 0) => {
  const distance = footprintDistance(footprint, point.x, point.z),
    profile = MILITARY_PROFILES.archer;
  return distance >= profile.minimumRange + margin &&
    distance <= profile.range * ARCHER_REACH_SHARE - margin;
};

/**
 * Candidate places of each kind before the reachability checks. Archers aim at the visible hall
 * (a camp's plot is larger) and the corners of a ring lie beyond bow reach, so their places
 * are the ring points inside the wall-shooting band (BUG-04).
 */
const candidatePlaces = (site: SettlementBuilding, kind: SlotKind) => {
  const target = structureAttackFootprint(site);
  if (kind === "archer")
    return ARCHER_RING_OFFSETS.flatMap((offset) => ringAround(target, offset))
      .filter((point) => inArcherBand(target, point, ARCHER_BAND_MARGIN));
  const reach = MILITARY_PROFILES[kind === "rider" ? "cavalry" : "shield"].range;
  return ringAround(buildingFootprint(site), SLOT_OFFSETS[kind])
    .filter((point) => footprintDistance(target, point.x, point.z) <= reach);
};

const slotKind = (actor: SettlementActor, state: MilitaryCombatant): SlotKind => {
  if (fightingType(state) === "archer") return "archer";
  return actor.mounted ? "rider" : "foot";
};

/**
 * Direct assault on a building's walls (colony forts, owner decision 2026-10-13): with every
 * defender dead, melee soldiers and riders take places around the plot and strike the walls;
 * archers shoot them from bow range. At 0 HP every attacker stops and the building burns down.
 */
interface AssaultPlace { building: number; index: number; layout: string }
/** Each wall attacker's place, in the order taken. */
export type StructureAssaultSave = SavedEntries<AssaultPlace>;

export const createStructureAssault = (context: SettlementContext, deps: AssaultDeps) => {
  const { actorById, doors, soldiers } = deps;
  const slotCache = new Map<string, { points: SettlementPoint[]; revision: number }>();
  /** Each attacker's place (index into its kind's ring); saved with the battle. */
  const places = new Map<number, AssaultPlace>();
  const building = (uid: number) => context.buildings.find((entry) => entry.uid === uid);
  const defended = (uid: number, faction: number) => {
    for (const soldier of soldiers.values())
      if (soldier.building === uid && soldier.combat?.faction === faction) return true;
    return false;
  };
  /** The player's field soldier nearest a player building, defending it; cached for one tick. */
  const fieldGuards = new Map<number, SettlementActor | null>();
  const fieldGuardOf = (site: SettlementBuilding) => {
    const cached = fieldGuards.get(site.uid);
    if (cached !== undefined) return cached;
    let guard: SettlementActor | null = null, nearest = FIELD_DEFENCE_REACH;
    for (const soldier of soldiers.values()) {
      if ((soldier.combat?.faction ?? 0) !== 0 || soldier.stationed || !(soldier.combat?.hp ?? 0)) continue;
      const body = actorById(soldier.actor);
      if (!body?.visible || body.phase !== "militaryField" || soldier.combat?.towerFall) continue;
      const distance = plotDistance(site, body);
      if (distance > nearest) continue;
      guard = body; nearest = distance;
    }
    fieldGuards.set(site.uid, guard);
    return guard;
  };
  /** The standing, undefended enemy walls this soldier's siege order points at. */
  const targetOf = (state: MilitaryCombatant) => {
    const door = state.siege === undefined ? undefined : doors.get(state.siege);
    if (!door?.structure || door.structure.hp <= 0 || door.faction === state.faction)
      return undefined;
    const site = building(door.building);
    if (
      !site ||
      (!isOpenArcherTower(site) && !site.eventCourtyard && defended(site.uid, door.faction))
    )
      return undefined;
    if ((isOpenArcherTower(site) || site.eventCourtyard) && fightingType(state) === "archer")
      return undefined;
    return { door, site, structure: door.structure };
  };
  /** Besiegers of a player building go for its field defenders first, then strike the walls. */
  const meetFieldGuard = (actor: SettlementActor, state: MilitaryCombatant, site: SettlementBuilding,
    door: MilitaryDoor, dt: number) => {
    const guard = isPlayerSiegeDoor(door) ? fieldGuardOf(site) : null;
    // Only a defender the besieger's faction knows (A13 phase 3); an unknown one leaves the walls to strike.
    if (!guard || context.factionKnowledge?.knows(state.faction, guard) === false) return false;
    probeUnitRead("raid.fieldGuard", state.faction, guard);
    deps.plan(actor, state, guard);
    deps.walk(actor, dt);
    return true;
  };
  const slotsOf = (site: SettlementBuilding, kind: SlotKind) => {
    const key = `${site.uid}:${kind}:${site.x}:${site.z}:${site.width}:${site.depth}`,
      revision = context.options.world.buildRevision ?? 0;
    const cached = slotCache.get(key);
    if (cached?.revision === revision) return cached.points;
    const reachable = reachableCells(context, site.access);
    const points = candidatePlaces(site, kind).filter(
      (point) =>
        reachable(point) &&
        isNavigationClear(context, point) &&
        (kind !== "rider" || isMountedNavigationClear(context, point))
    );
    slotCache.set(key, { points, revision });
    return points;
  };
  /** The nearest place nobody else holds (or the nearest one when all are taken). */
  const placeOf = (actor: SettlementActor, site: SettlementBuilding, kind: SlotKind) => {
    const points = slotsOf(site, kind),
      held = places.get(actor.uid);
    const layout = `${site.x}:${site.z}:${site.width}:${site.depth}`;
    if (held?.layout === layout && held.building === site.uid && points[held.index])
      return points[held.index]!;
    const taken = new Set<number>();
    for (const [id, place] of places)
      if (id !== actor.uid && place.building === site.uid && place.layout === layout)
        taken.add(place.index);
    let best = -1,
      bestDistance = Infinity,
      fallback = -1,
      fallbackDistance = Infinity;
    points.forEach((point, index) => {
      const distance = DMath.hypot(point.x - actor.x, point.z - actor.z);
      if (distance < fallbackDistance) {
        fallback = index;
        fallbackDistance = distance;
      }
      if (!taken.has(index) && distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    const index = best >= 0 ? best : fallback;
    if (index < 0) return undefined;
    places.set(actor.uid, { building: site.uid, index, layout });
    return points[index];
  };
  const inReach = (actor: SettlementActor, state: MilitaryCombatant, site: SettlementBuilding) => {
    const footprint = structureAttackFootprint(site);
    if (fightingType(state) === "archer") return inArcherBand(footprint, actor);
    return footprintDistance(footprint, actor.x, actor.z) <= MILITARY_PROFILES[fightingType(state)].range;
  };
  /** Starts a blow (or a draw) at the walls; it lands as a door blow does, at 75 % of the swing. */
  const strike = (actor: SettlementActor, state: MilitaryCombatant, site: SettlementBuilding) => {
    deps.stand(actor);
    actor.yaw = DMath.atan2(site.x - actor.x, site.z - actor.z);
    if (state.cooldown) return;
    state.cooldown = MILITARY_PROFILES[fightingType(state)].interval;
    state.attackTime = 0.6;
    actor.animationTime = 0;
    state.doorBlow = true;
  };
  /** Ends every attack on a fallen building: its attackers stand where they are. */
  const fall = (uid: number, attacker: SettlementActor | undefined) => {
    const door = doors.get(uid);
    if (!door?.structure) return;
    door.structure.hp = 0;
    door.structure.fallen = 0;
    const site = building(uid);
    if (site && context.script) emitBuildingDestroyed(context, site, "destroyed", unitSource(attacker));
    if (site)
      releaseTowerArchers(context, site, soldiers, deps.actorById, Boolean(site.eventCourtyard));
    for (const soldier of soldiers.values()) {
      if (soldier.combat?.siege !== uid) continue;
      soldier.combat.siege = undefined;
      soldier.combat.doorBlow = undefined;
      places.delete(soldier.actor);
    }
  };
  /**
   * The soldiers left at a fallen tower step out. The player's own lose its protection and stand in
   * the field, fighting or walking back to storage (MIL-ASSAULT 2026-11-08).
   */
  const releaseFallenSite = (site: SettlementBuilding, playerSite: boolean) => {
    if (site.typeId !== 16 && !playerSite) return;
    if (site.typeId === 16) site.catapultCycle = undefined;
    const remaining = new Map([...soldiers].filter(([, guard]) => guard.building === site.uid));
    if (playerSite) releaseFallenSiteSoldiers(context, remaining, site);
    else releaseRemovedSiteSoldiers(context, remaining, site, site.uid);
  };
  /**
   * Outside the burn-down timeline (BD2): a ruin replaces the building on its fall, or, for an owner without an
   * economy, the building crumbles after the fort ruin time (the timed crumble, plan review B6). Its civilians
   * step out where, like everyone outdoors, enemies can attack them (`removeFallenBuilding`).
   */
  const leaveUnburnt = (site: SettlementBuilding, fallen: number) => {
    if (leavesRuin(context, site) || fallen >= FORT_REMOVAL_SECONDS) removeFallenBuilding(context, site);
  };
  /** `attacker`: the striking soldier (the map script's damage source), when known. */
  const damage = (uid: number, amount: number, attacker?: SettlementActor) => {
    const structure = doors.get(uid)?.structure;
    if (!structure || structure.hp <= 0) return;
    const before = structure.hp;
    structure.hp = Math.max(0, structure.hp - amount);
    if (context.script) emitBuildingDamaged(context, uid, unitSource(attacker),
      { after: structure.hp, before, maximum: structure.maximum });
    if (!structure.hp) fall(uid, attacker);
  };
  /** The standing walls of a building for the development tools (a player building takes them first). */
  const standingWalls = (uid: number) => {
    const site = building(uid);
    if (site) fortifyPlayerSite(site, doors, context.buildings);
    const structure = doors.get(uid)?.structure;
    return structure && structure.hp > 0 ? structure : undefined;
  };
  /** The standing open scaffold of another faction that soldier `id` shoots from, if any. */
  const scaffoldOf = (id: number | undefined, faction: number) => {
    const shooter = id === undefined ? undefined : soldiers.get(id);
    if (!shooter?.stationed || shooter.combat?.faction === faction) return undefined;
    const site = building(shooter.building), structure = doors.get(shooter.building)?.structure;
    return site && isOpenArcherTower(site) && structure && structure.hp > 0 ? site.uid : undefined;
  };
  return {
    scaffoldOf,
    /** Whether the soldier's siege now means striking walls (no defender left). */
    targets: (state: MilitaryCombatant) => targetOf(state) !== undefined,
    /** No one to fight: walk to a place at the walls and strike. False when there is nothing to assault. */
    update: (actor: SettlementActor, state: MilitaryCombatant, dt: number) => {
      const target = targetOf(state);
      if (!target) return false;
      if (meetFieldGuard(actor, state, target.site, target.door, dt)) return true;
      const assaultSite = courtyardAssaultSite(target.site, actor);
      if (inReach(actor, state, assaultSite)) {
        strike(actor, state, assaultSite);
        return true;
      }
      const place = placeOf(actor, assaultSite, slotKind(actor, state));
      deps.plan(actor, state, place ?? target.site.access);
      deps.walk(actor, dt);
      return true;
    },
    /** The blow started by `strike` lands: melee damage at once, an arrow from a bow. */
    release: (actor: SettlementActor, soldier: SettlementSoldier, state: MilitaryCombatant) => {
      const target = targetOf(state);
      if (!target) return false;
      const full = deps.random.at("assault.wallContact", soldier.actor)() < 0.7 + soldier.rank * 0.1;
      if (fightingType(state) !== "archer") {
        if (!inReach(actor, state, courtyardAssaultSite(target.site, actor))) return true;
        const amount = structureDamage(fightingType(state), soldier.rank, full,
          deps.random.at("assault.wallDamage", soldier.actor)) *
          siegeTalentFactor(context, state.faction);
        if (!strikeCourtyardWall(context, target.site, actor, amount))
          damage(target.site.uid, amount, actor);
        releaseCourtyardDefenders(context, target.site, soldiers, actorById);
        return true;
      }
      deps.random.at("assault.wallAim", soldier.actor);
      const offset = {
        x: (deps.random() - 0.5) * target.site.width * 0.5,
        z: (deps.random() - 0.5) * target.site.depth * 0.5
      };
      deps.fireAtWall(
        soldier,
        actor,
        { x: target.site.x + offset.x, y: target.site.y + 0.8, z: target.site.z + offset.z },
        target.site.uid
      );
      return true;
    },
    /** An arrow aimed at walls stopped at `point`: near the plot it hits them at full damage. */
    arrowStopped: (wall: number, rank: number, point: SettlementPoint & { faction?: number; shooter?: number }) => {
      const site = building(wall);
      if (
        !site ||
        site.eventCourtyard ||
        footprintDistance(buildingFootprint(site), point.x, point.z) > ARROW_WALL_MARGIN
      )
        return;
      // Looked up only for a listening map script (its damage source).
      const shooter = context.script && point.shooter !== undefined ? actorById(point.shooter) : undefined;
      damage(wall, structureDamage("archer", rank, true, deps.random.at("assault.arrowDamage", wall)) *
        siegeTalentFactor(context, point.faction ?? 1), shooter);
    },
    /** Fallen buildings burn on, collapse and smoulder: seconds since the fall. */
    tick: (dt: number) => {
      fieldGuards.clear();
      for (const door of doors.values()) {
        if (door.structure?.fallen !== undefined) door.structure.fallen += dt;
        const site = building(door.building), playerSite = isPlayerSiegeDoor(door);
        if (!site) continue;
        if (door.structure?.hp === 0 && !burnsDownWhenFallen(site)) {
          leaveUnburnt(site, door.structure.fallen ?? 0);
          continue;
        }
        // Burnt-down sites of owners with an economy (the player, a computer economy: EAI2b) leave a ruin.
        if (!site.eventCourtyard && site.typeId !== 16 && !playerSite && !leavesRuin(context, site)) continue;
        if (site.eventCourtyard) releaseCourtyardDefenders(context, site, soldiers, actorById);
        if (door.structure?.hp === 0) releaseFallenSite(site, playerSite);
        if ((door.structure?.fallen ?? 0) < FORT_REMOVAL_SECONDS) continue;
        // A fallen Academy cancels its training batch; a fallen Lodge evicts its commander wounded (owner
        // 2026-11-09). The player's burnt-down building leaves a ruin for the clearing job (Q-BD7).
        removeFallenBuilding(context, site);
      }
    },
    damage,
    /** Development tool (BD2): the walls fall at once, as if beaten down (a player building takes them first). */
    destroy: (uid: number) => {
      const structure = standingWalls(uid);
      if (!structure) return false;
      damage(uid, structure.hp);
      return true;
    },
    /** Development tool (EAI2d): the walls lose `amount` HP at once, as if beaten (they fall at 0). */
    damageWalls: (uid: number, amount: number) => {
      if (!Number.isFinite(amount) || amount <= 0 || !standingWalls(uid)) return false;
      damage(uid, amount);
      return true;
    },
    forget: (id: number) => {
      places.delete(id);
    },
    removeBuilding: (uid: number) => {
      for (const key of slotCache.keys()) if (key.startsWith(`${uid}:`)) slotCache.delete(key);
      for (const [id, place] of places) if (place.building === uid) places.delete(id);
    },
    clear: () => {
      places.clear();
    },
    save: (): StructureAssaultSave => saveEntries(places),
    restore: (saved: StructureAssaultSave | undefined) =>
      restoreEntries(places, saved)
  };
};
