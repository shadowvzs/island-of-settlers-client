import { isSafeCount } from "../../../../island-of-settlers-shared/src/validation/index";
import type { ShipFrame, ShipSiteFrame } from "../../render-common/ships/ship-frame";
import {
  COLONY_COUNTERATTACKS, COUNTERATTACK_GARRISON_MINIMUM, FIRST_COUNTERATTACK_SECONDS, FIRST_RAID_SHIP_SECONDS
} from "../balance/colonies";
import { RAID_NEARBY_RADIUS } from "../balance/military";
import type { ColonyDifficulty } from "./colony-expedition-rules";
import type { ColonyCounterattackRule } from "./colony-island-rules";
import { createColonyRaidSites } from "./colony-raid-sites";
import { type DifficultyLevel, difficultyRank, difficultyScaled } from "./difficulty";
import { DEVELOP_MODE } from "./economy-ai/constants";
import { probeUnitRead } from "./faction-vision-probe";
import {
  OTHER_BUILDING_TIERS, pickRaidSiegeSite, type RaidSiegeSite, URGENT_BUILDING_TIERS
} from "./raid-target-priority";
import {
advanceLandingSoldier,   ADVENTURE_ABOARD, ADVENTURE_LANDING_PHASES, type AdventureLanding,
adventureLandingError,   cavalryLastLandingOrder, createLandingQueue, findLandingNear,
gangwayTurn, gatherSlot} from "./settlement-adventure-landing";
import { reachableCells } from "./settlement-colony";
import { distanceBetween } from "./settlement-geometry";
import type { createSettlementMilitary, SettlementSoldier } from "./settlement-military";
import { ownerOf } from "./settlement-ownership";
import { groundPath } from "./settlement-paths";
import { raidDeckPoints } from "./settlement-raid-deck";
import {
  type RaidArrival, raidCourse, type RaidDeparture, raidLegError, raidShipPosition
} from "./settlement-raid-ship-course";
import { createSeaMask } from "./settlement-sea-navigation";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

type SettlementMilitary = ReturnType<typeof createSettlementMilitary>;

/** The computer's side on a colony. */
const ENEMY = 1;
/** Visual only: the raid ship's id, apart from fleet, harbour dock and adventure ship ids. */
const RAID_SHIP_ID = 1_900_001;
/**
 * The raid ship of the `launches`-th raid: odd launches keep RAID_SHIP_ID, even ones the next id, so
 * successive raids alternate the two pirate hulls (picked by ship id parity, `pirateShipVariant`).
 */
export const raidShipId = (launches = 1) => RAID_SHIP_ID + (launches + 1) % 2;
/** The raid ship weighs anchor this long after its last soldier is ashore. */
const SHIP_LINGER_SECONDS = 20;

/**
 * A raid ship anchored off the player's building it attacks, its gangway out; it sails in (`arrival`)
 * and, once its troops are ashore and it has lingered, sails away (`departure`).
 */
export interface ColonyRaidShip {
  landing: AdventureLanding; target: number; linger: number;
  arrival?: RaidArrival;
  departure?: RaidDeparture;
}
export interface ColonyCounterattackSave {
  /** Seconds until the next land counterattack and the next raid ship. */
  landTime: number;
  shipTime: number;
  /** Raid ships launched so far (picks the raid ship's id); saves without it count one. */
  launches?: number;
  /** Enemy soldiers sent against the player (land parties and ship troops). */
  raiders: number[];
  ship?: ColonyRaidShip;
}

/** Shape of a saved counterattack (soldier identities are checked by the military save). */
export const colonyCounterattackError = (saved: ColonyCounterattackSave | undefined) => {
  if (saved === undefined) return false;
  const ship = saved.ship;
  const shipError = () => !ship || !isSafeCount(ship.target) || !Number.isFinite(ship.linger) ||
    adventureLandingError(ship.landing) || raidLegError(ship.arrival, ship.arrival?.from) ||
    raidLegError(ship.departure, ship.departure?.to);
  return !Number.isFinite(saved.landTime) || !Number.isFinite(saved.shipTime) || !Array.isArray(saved.raiders) ||
    !saved.raiders.every(isSafeCount) || (saved.launches !== undefined && !isSafeCount(saved.launches)) ||
    (ship !== undefined && shipError());
};


/** Raiders re-ordered against the player's troops only when none stands this close (tiles). */
const RAID_ENGAGE_RADIUS = 8;
/**
 * Raider priority (owner 2026-11-09): only player field soldiers within this many tiles of a raider
 * or of the building it goes for are attacked first; farther ones are ignored and the raid besieges
 * its target. A soldier entering the radius mid-siege pulls the besiegers off the walls.
 */
export const RAID_NEARBY_SOLDIER_RADIUS = RAID_NEARBY_RADIUS;
/** A raider walking home this close (tiles) to its fort's entrance goes back in. */
const RAID_HOME_ARRIVAL = 3;
/**
 * A besieging raider looks for a more urgent target within the nearby radius every this many ticks (1 s,
 * plan review B9), staggered by its uid; otherwise it keeps its target until it falls.
 */
const RAID_RETARGET_TICKS = 20;

type RaidShipRule = NonNullable<ColonyCounterattackRule["ship"]>;

/** The land party's size at the live difficulty; Normal keeps the authored size untouched. */
export const scaledLandRaidSize = (rule: ColonyCounterattackRule, level?: DifficultyLevel) =>
  difficultyScaled(rule.landSize, "raidSize", level);

/** The raid ship's troop list at the live difficulty (size and tier), cycling its authored types and ranks. */
export const scaledRaidShipTroops = (rule: RaidShipRule, level?: DifficultyLevel) => {
  const count = difficultyScaled(rule.troops.length, "raidSize", level);
  return Array.from({ length: count }, (_, index) => ({
    rank: difficultyRank(rule.ranks[index % rule.ranks.length]!, level),
    type: rule.troops[index % rule.troops.length]!
  }));
};

/** The player's field soldier nearest `from` among those within the raid radius of the raider or its goal. */
const nearbyTroop = (
  context: SettlementContext, troops: readonly SettlementActor[], from: SettlementPoint, goal?: SettlementPoint
) => {
  let best: SettlementActor | undefined, bestDistance = Infinity;
  for (const body of troops) {
    const span = distanceBetween(body, from);
    const near = span <= RAID_NEARBY_SOLDIER_RADIUS ||
      (goal !== undefined && distanceBetween(body, goal) <= RAID_NEARBY_SOLDIER_RADIUS);
    if (!near || context.factionKnowledge?.knows(ENEMY, body) === false) continue;
    probeUnitRead("raid.nearbyTroop", ENEMY, body);
    if (span < bestDistance) { best = body; bestDistance = span; }
  }
  return best;
};
const nearestTo = (sites: readonly SettlementBuilding[], from: SettlementPoint) =>
  [...sites].sort((a, b) => distanceBetween(a.access, from) - distanceBetween(b.access, from) || a.uid - b.uid)[0];
/** The player's building nearest a hostile fort; null if none is joined by land. */
const landTarget = (
  context: SettlementContext, forts: readonly SettlementBuilding[], sources: readonly SettlementBuilding[]
) => {
  const pairs = forts.flatMap(fort => sources.map(source =>
    ({ fort, source, span: distanceBetween(fort.access, source.access) })))
    .sort((a, b) => a.span - b.span || a.fort.uid - b.fort.uid);
  return pairs.find(({ fort, source }) => groundPath(context, source.access, fort.access)) ?? null;
};
/** Spare defenders of the hostile forts, nearest fort first; every fort keeps its minimum. */
const spareDefenders = (
  military: SettlementMilitary, target: SettlementBuilding, sources: readonly SettlementBuilding[], size: number
) => {
  const soldiers = military.soldiers(), ids: number[] = [];
  const nearest = [...sources].sort((a, b) =>
    distanceBetween(a.access, target.access) - distanceBetween(b.access, target.access));
  for (const source of nearest) {
    const garrison = soldiers.filter(soldier => soldier.building === source.uid && soldier.stationed &&
      soldier.combat?.faction === ENEMY && soldier.combat.type !== "archer").sort((a, b) => a.actor - b.actor);
    const total = soldiers.filter(soldier => soldier.building === source.uid && soldier.stationed).length;
    ids.push(...garrison.slice(0, Math.max(0, total - COUNTERATTACK_GARRISON_MINIMUM)).map(soldier => soldier.actor));
    if (ids.length >= size) break;
  }
  return ids.slice(0, size);
};

/**
 * Colony counterattacks (owner decisions 2026-10-13): from medium difficulty, once the player has
 * destroyed a fort, the remaining forts send part of their garrisons over land against the
 * player's troops (soldiers walking between buildings, the reinforcements riders hunt); on hard,
 * new troops also arrive by ship, standing on its deck until it puts out its gangway, then land and
 * attack. Forts captured in older saves are besieged as before. Every landing is checked first: its
 * shore and the player's building are joined by land, so no enemy is stranded out of reach.
 */
export const createColonyCounterattacks = (context: SettlementContext, military: SettlementMilitary) => {
  let state: ColonyCounterattackSave | undefined;
  let shipQueue = createLandingQueue([], actor => military.troopType(actor.uid));
  /**
   * Forts the player captured (saves before 2026-10-13): a door without walls. The player's walled
   * Catapult Towers and assaulted military buildings are not captured forts.
   */
  const captured = () => {
    const walled = new Set(military.combat.doors().filter(door => door.structure).map(door => door.building));
    return context.buildings.filter(building => building.militaryFaction === 0 && !walled.has(building.uid));
  };
  const { anchors, probeSite, siegeEntries } = createColonyRaidSites(context, military, ENEMY);
  /** The player's soldiers standing in the field (gathered once per update, in soldier order). */
  const playerTroops = (bodies: ReadonlyMap<number, SettlementActor>) => military.soldiers().flatMap(soldier => {
    if ((soldier.combat?.faction ?? 0) !== 0 || soldier.stationed) return [];
    const body = bodies.get(soldier.actor);
    return body?.phase === "militaryField" && body.visible ? [body] : [];
  });
  const actorMap = () => new Map(context.actors.map(actor => [actor.uid, actor]));
  const nearestAnchor = (from: SettlementPoint) => nearestTo(anchors(), from);
  /**
   * Raider priority (owner 2026-11-09): the player's soldiers near the raid or its target first; a
   * military building is besieged when none is near, else the raid marches on the building.
   */
  const attack = (ids: readonly number[], target: SettlementBuilding) => {
    const bodies = actorMap(), from = bodies.get(ids[0]!) ?? target.access;
    const troop = nearbyTroop(context, playerTroops(bodies), from, target.access);
    return Boolean(troop && military.combat.commandOpponent(ids, troop, ENEMY)) ||
      military.combat.siegeOpponent(ids, target.uid, ENEMY) ||
      military.combat.commandOpponent(ids, target.access, ENEMY);
  };
  const hostile = () => context.buildings.filter(building => ownerOf(building) > 0);
  const soldiersById = () => new Map(military.soldiers().map(soldier => [soldier.actor, soldier]));
  const bodyOf = (id: number) => context.actors.find(actor => actor.uid === id);
  /** A director force handed back for its hit: it attacks its known target, or presses the raid as raiders. */
  const handover = (ids: readonly number[], target: number | undefined) => {
    const site = target === undefined ? undefined : context.buildingByUid?.get(target) ??
      context.buildings.find(building => building.uid === target);
    if (!site) return true;
    probeSite("raid.handover", site);
    attack(ids, site);
    return true;
  };
  /**
   * A land permit (A14 plan §5.2): the timers pick when and the nearest joined fort pair who goes; the strategic
   * director then picks the target from what the army knows (a scout first when it knows no site). Without a
   * director (no AI commander) or with its force cap reached, the party attacks at once as before.
   */
  const launchLand = (rule: ColonyCounterattackRule, current: ColonyCounterattackSave) => {
    const sources = hostile(), pair = landTarget(context, anchors(), sources);
    if (!pair) return;
    const ids = spareDefenders(military, pair.fort, sources, scaledLandRaidSize(rule, context.difficulty));
    if (!ids.length) return;
    const launch = { home: pair.source.access, kind: "colony" as const };
    const launched = context.militaryDirector?.launch(ENEMY, ids, launch) === true;
    if (launched || attack(ids, pair.fort)) current.raiders.push(...ids);
  };
  /** A landing whose shore and gathering ground are joined by land to the player's building. */
  const raidLanding = (target: SettlementBuilding) => {
    const reachable = reachableCells(context, target.access);
    return findLandingNear(context, target.access, landing => reachable(landing.gangway.shore) &&
      groundPath(context, gatherSlot(context, landing.gangway.shore, 0), target.access) !== null &&
      incomingRoute(landing) !== undefined);
  };
  /** New enemy troops standing on the anchored raid ship's deck, waiting for the gangway. */
  const board = (landing: AdventureLanding, rule: RaidShipRule) => {
    const troops = cavalryLastLandingOrder(scaledRaidShipTroops(rule, context.difficulty),
      troop => troop.type);
    const pose = { ...landing.water, yaw: landing.yaw };
    const ids = raidDeckPoints(pose, troops.length, context.options.world.seaLevel).flatMap((deck, index) => {
      const id = military.combat.spawnOpponentAboard(deck, troops[index]!.type, troops[index]!.rank,
        ENEMY, ADVENTURE_ABOARD);
      const body = id === null ? undefined : bodyOf(id);
      if (!body) return [];
      body.yaw = landing.yaw; body.timer = gangwayTurn(index);
      return [body.uid];
    });
    shipQueue = createLandingQueue(ids.map(id => bodyOf(id)!), actor => military.troopType(actor.uid));
    return ids;
  };
  let sea: Uint8Array | undefined;
  let seaRevision: number | undefined;
  const anchored = (ship: ColonyRaidShip) => !ship.arrival && !ship.departure;
  /** The clear course in (`side` -1) to `landing`, or out (1) from it, over the current sea. */
  const course = (landing: AdventureLanding, side: -1 | 1) => {
    const world = context.options.world;
    if (!sea || seaRevision !== world.terrainRevision) {
      sea = createSeaMask(world); seaRevision = world.terrainRevision;
    }
    return raidCourse(world, sea, landing, side);
  };
  const incomingRoute = (landing: AdventureLanding): RaidArrival | undefined => {
    const way = course(landing, -1);
    return way && { duration: way.duration, elapsed: 0, from: way.end };
  };
  const raidPosition = (ship: ColonyRaidShip) => raidShipPosition(ship.landing, ship.arrival, ship.departure);
  const launchShip = (rule: ColonyCounterattackRule, current: ColonyCounterattackSave) => {
    if (!rule.ship) return;
    // Plan §5.2: next to a building the army knows, else the player's home harbour (owner Q3).
    for (const target of anchors()) {
      const landing = raidLanding(target);
      if (!landing) continue;
      const arrival = incomingRoute(landing);
      if (!arrival) continue;
      current.raiders.push(...board(landing, rule.ship));
      current.ship = { arrival, landing, linger: SHIP_LINGER_SECONDS, target: target.uid };
      current.launches = (current.launches ?? 0) + 1;
      for (const id of current.raiders) {
        const body = bodyOf(id);
        if (body?.phase !== ADVENTURE_ABOARD) continue;
        body.x += arrival.from.x - landing.water.x; body.z += arrival.from.z - landing.water.z;
      }
      return;
    }
  };
  const marchOn = (body: SettlementActor, goal: SettlementPoint) => {
    if (distanceBetween(goal, body) > RAID_ENGAGE_RADIUS) military.combat.commandOpponent([body.uid], goal, ENEMY);
  };
  /**
   * Nothing left to fight (owner 2026-11-09): the raider walks back to the nearest computer fort and
   * goes in; one that cannot (a rider, a full garrison, no way home) leaves the field there, as an
   * enemy camp's returning raiders do.
   */
  const returnHome = (body: SettlementActor) => {
    const home = nearestTo(hostile(), body);
    if (home && !military.combat.commandOpponent([body.uid], home.access, ENEMY, "move"))
      military.combat.withdrawOpponent(body.uid);
  };
  /** A raider standing at a computer fort's entrance goes in (or leaves the field there). */
  const enterHome = (body: SettlementActor) => {
    const home = nearestTo(hostile(), body);
    if (!home || distanceBetween(home.access, body) > RAID_HOME_ARRIVAL) return false;
    if (!military.combat.rejoinGarrison(body.uid, home.uid)) military.combat.withdrawOpponent(body.uid);
    return true;
  };
  /** Tier 5: the nearest known other building, besieged once no civilian is left in reach (BD1). */
  const besiegeOtherBuilding = (body: SettlementActor, sites: readonly RaidSiegeSite[]) => {
    const other = pickRaidSiegeSite(sites, body, OTHER_BUILDING_TIERS);
    if (other) probeSite("raid.other", other);
    return Boolean(other && military.combat.siegeOpponent([body.uid], other.uid, ENEMY));
  };
  /**
   * Landed or idle raiders (owner 2026-11-09, raid-target-priority.ts): a player soldier near the
   * raider or its target first; else they besiege the most urgent known player building of tier 2-3 (one
   * that holds soldiers, then an unshielded Academy or Lodge or a building with reserves; nearest within a
   * tier), else march on the player's base, hunt the civilians outside there, then besiege the nearest
   * known other building (tier 5, BD1), and walk home once nothing is left. In the smart commander mode
   * this stays the raid's objective: the commander only turns raiders to attack or retreat.
   */
  const orderRaider = (
    body: SettlementActor, sites: readonly RaidSiegeSite[], troops: readonly SettlementActor[]
  ) => {
    const fort = pickRaidSiegeSite(sites, body, URGENT_BUILDING_TIERS), anchor = fort ?? nearestAnchor(body);
    if (fort) probeSite("raid.siege", fort);
    const troop = nearbyTroop(context, troops, body, anchor?.access);
    if (troop) { marchOn(body, troop); return; }
    if (fort && military.combat.siegeOpponent([body.uid], fort.uid, ENEMY)) return;
    if (enterHome(body)) return;
    if (anchor && distanceBetween(anchor.access, body) > RAID_ENGAGE_RADIUS) {
      military.combat.commandOpponent([body.uid], anchor.access, ENEMY);
      return;
    }
    if (military.combat.civilianInReach(body.uid) || besiegeOtherBuilding(body, sites)) return;
    returnHome(body);
  };
  /** A besieger not in a door fight turns on a player soldier that came near it or its target. */
  const pullOffWalls = (body: SettlementActor, siege: number, troops: readonly SettlementActor[]) => {
    if (!troops.length || military.combat.atDoor(body.uid)) return false;
    const site = context.buildingByUid?.get(siege) ?? context.buildings.find(building => building.uid === siege);
    const troop = nearbyTroop(context, troops, body, site?.access);
    return Boolean(troop && military.combat.commandOpponent([body.uid], troop, ENEMY));
  };
  /**
   * Plan review B9: a besieger keeps its target until it falls, except that once a second it switches to a
   * known building of a more urgent tier within the nearby radius (no flip-flop between equal tiers).
   */
  const retargetSiege = (body: SettlementActor, siege: number, sites: readonly RaidSiegeSite[]) => {
    const tick = context.clock?.tick();
    if (tick === undefined || (tick + body.uid) % RAID_RETARGET_TICKS !== 0 || military.combat.atDoor(body.uid)) return;
    const current = sites.find(entry => entry.site.uid === siege)?.tier;
    if (current === undefined || current <= URGENT_BUILDING_TIERS.from) return;
    const near = sites.filter(entry => entry.tier < current &&
      distanceBetween(entry.site.access, body) <= RAID_NEARBY_SOLDIER_RADIUS);
    const better = pickRaidSiegeSite(near, body);
    if (!better) return;
    probeSite("raid.retarget", better);
    military.combat.siegeOpponent([body.uid], better.uid, ENEMY);
  };
  const orderRaiders = (current: ColonyCounterattackSave, soldiers: ReadonlyMap<number, SettlementSoldier>) => {
    let sites: readonly RaidSiegeSite[] | undefined, troops: SettlementActor[] | undefined;
    let bodies: ReadonlyMap<number, SettlementActor> | undefined;
    for (const id of current.raiders) {
      const combat = soldiers.get(id)?.combat;
      if (!combat || combat.destination || combat.target !== undefined || context.militaryDirector?.owns(id)) continue;
      bodies ??= actorMap();
      const body = bodies.get(id);
      if (body?.phase !== "militaryField") continue;
      troops ??= playerTroops(bodies);
      sites ??= siegeEntries();
      if (combat.siege === undefined) { orderRaider(body, sites, troops); continue; }
      if (!pullOffWalls(body, combat.siege, troops)) retargetSiege(body, combat.siege, sites);
    }
  };
  /**
   * The raid ship leaves once every soldier is ashore and a moment has passed: it weighs anchor and sails
   * on out of sight (or, with no clear water ahead, is gone at once as before).
   */
  const updateShip = (current: ColonyCounterattackSave, dt: number) => {
    if (!current.ship) return;
    const ship = current.ship;
    if (ship.departure) {
      ship.departure.elapsed += dt;
      if (ship.departure.elapsed >= ship.departure.duration) current.ship = undefined;
      return;
    }
    if (ship.arrival) {
      const before = raidPosition(ship);
      ship.arrival.elapsed += dt;
      const after = raidPosition(ship);
      for (const id of current.raiders) {
        const body = bodyOf(id);
        if (body?.phase !== ADVENTURE_ABOARD) continue;
        body.x += after.x - before.x; body.z += after.z - before.z;
      }
      if (ship.arrival.elapsed >= ship.arrival.duration) ship.arrival = undefined;
      return;
    }
    const aboard = current.raiders.some(id => ADVENTURE_LANDING_PHASES.includes(bodyOf(id)?.phase ?? ""));
    if (aboard) return;
    ship.linger -= dt;
    if (ship.linger > 0) return;
    const way = course(ship.landing, 1);
    if (way) ship.departure = { duration: way.duration, elapsed: 0, to: way.end };
    else current.ship = undefined;
  };
  /** `struck`: the player has destroyed (or, in older saves, captured) a fort; attacks begin then. */
  const update = (dt: number, difficulty: ColonyDifficulty, struck: boolean) => {
    const rule = COLONY_COUNTERATTACKS[difficulty];
    if (!rule) return;
    // The director hands colony forces back here for their hit (also after a load).
    context.militaryDirector?.setHandover("colony", handover);
    if (state) {
      const soldiers = soldiersById();
      state.raiders = state.raiders.filter(id => soldiers.has(id) && soldiers.get(id)!.building === -3);
      orderRaiders(state, soldiers);
      updateShip(state, dt);
    }
    // A `develop` faction attacks through its own economy AI (EAI4c): no timed counterattack while it develops.
    if (context.factionAi?.setting(ENEMY)?.mode === DEVELOP_MODE) return;
    if (!(struck || captured().length) || !hostile().length) return;
    const current = state ??= { landTime: FIRST_COUNTERATTACK_SECONDS, raiders: [], shipTime: FIRST_RAID_SHIP_SECONDS };
    current.landTime -= dt;
    if (current.landTime <= 0) { current.landTime = rule.landInterval; launchLand(rule, current); }
    if (!rule.ship || current.ship) return;
    current.shipTime -= dt;
    if (current.shipTime <= 0) { current.shipTime = rule.ship.interval; launchShip(rule, current); }
  };
  const updateActor = (actor: SettlementActor, dt: number) => {
    const ship = state?.ship;
    if (!ship || !ADVENTURE_LANDING_PHASES.includes(actor.phase) || !state!.raiders.includes(actor.uid)) return false;
    if (ship.arrival) return true;
    if (!shipQueue.canAdvance(actor, dt)) return true;
    advanceLandingSoldier(context, ship.landing, actor, dt);
    shipQueue.departed(actor);
    return true;
  };
  const shipFrames = (): ShipFrame[] => state?.ship ? [{ cargoCount: 0, id: raidShipId(state.launches),
    livery: "enemy", phase: anchored(state.ship) ? "idle" : "sailing", x: raidPosition(state.ship).x,
    y: context.options.world.seaLevel, yaw: state.ship.landing.yaw, z: raidPosition(state.ship).z }] : [];
  const shipSites = (): ShipSiteFrame[] => state?.ship && anchored(state.ship) ? [{ id: raidShipId(state.launches),
    kind: "dock", progress: 1, workPier: state.ship.landing.gangway, x: state.ship.landing.water.x,
    y: context.options.world.seaLevel, yaw: state.ship.landing.yaw, z: state.ship.landing.water.z }] : [];
  return {
    isRaider: (uid: number) => state?.raiders.includes(uid) ?? false,
    /** A raid ship or raider that `update`/`updateActor` could still advance. */
    hasLiveRaiders: () => Boolean(state?.ship || state?.raiders.length),
    save: () => state && structuredClone(state),
    restore: (saved?: ColonyCounterattackSave) => {
      state = saved && structuredClone(saved);
      const aboard = (state?.raiders ?? []).flatMap(id => bodyOf(id) ?? []);
      shipQueue = createLandingQueue(aboard, actor => military.troopType(actor.uid));
    },
    shipFrames,
    shipSites,
    snapshot: () => state && { raiders: state.raiders.length, ship: Boolean(state.ship) },
    update,
    updateActor
  };
};
