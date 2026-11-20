import { describe, expect, it } from "vitest";

import { MILITARY_PROFILES } from "../src/shared/balance/military";
import { militaryHealth, type MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";
import { createMilitarySpatialGrid } from "../src/shared/settlement/military-spatial-grid";
import {
  ARCHER_RETREAT_BUDGET, ARCHER_RETREAT_CALM, ARCHER_RETREAT_GOAL, archerRetreatStep, archerThreatRadius,
  calmRetreat, canBackAway, isArcherRetreatClear, isRescoreTick, recordRetreatStep, shouldSwitchTarget, stanceOf,
  targetScore
} from "../src/shared/settlement/military-targeting";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { actorSeparation, isMilitaryPassThrough } from "../src/shared/settlement/settlement-traffic";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { PROP, type WorldData } from "../src/shared/world/world-data";
import { createBalanceSimulation, placeHostileSite, spawnAround } from "../tools/bench/garrison-balance-harness";

/** Battle AI (docs/archive/dated/battle-ai-plan-2026-10-12.md, owner decisions 6a): stances, hit response, archers. */
const SIZE = 48;
const START = { x: 6.5, z: 6.5 };

/**
 * Both sides here are scripted computer factions standing in for the player: the stance rules under
 * test are the ones the player's soldiers follow.
 */
const battle = (shape?: (world: WorldData) => void) => {
  const simulation = createBalanceSimulation(SIZE, 3, START, shape, { withoutMilitaryCommander: true });
  const spawn = (point: { x: number; z: number }, type: MilitaryTroopType, faction: number, rank = 0) => {
    const id = simulation.spawnMilitaryOpponent(point, type, rank, faction);
    if (id === null) throw new Error("No room to spawn");
    return id;
  };
  const body = (id: number) => simulation.frames().find(actor => actor.uid === id);
  const soldier = (id: number) => simulation.militarySoldiers().find(entry => entry.actor === id);
  const health = (id: number) => soldier(id)?.combat?.hp ?? 0;
  const advance = (seconds: number, each?: () => void) => {
    for (let tick = 0; tick < seconds * 20; tick++) { each?.(); simulation.update(.05); }
  };
  const distance = (id: number, point: { x: number; z: number }) => {
    const actor = body(id)!;
    return Math.hypot(actor.x - point.x, actor.z - point.z);
  };
  return { advance, body, distance, health, simulation, soldier, spawn };
};

/** Holds a soldier where it stands (a scripted dummy). */
const pin = (simulation: SettlementSimulation, id: number) => () => {
  const actor = simulation.frames().find(entry => entry.uid === id);
  if (actor) { actor.path = []; actor.pathIndex = 0; }
};

describe("battle AI rules", () => {
  it("classifies stances from the order", () => {
    expect(stanceOf({ destination: { x: 1, z: 1 }, order: "retreat" }, false)).toBe("retreat");
    expect(stanceOf({ destination: { x: 1, z: 1 }, order: "move" }, false)).toBe("move");
    expect(stanceOf({ destination: { x: 1, z: 1 }, order: "attackMove" }, true)).toBe("march");
    expect(stanceOf({ order: "attackMove" }, false)).toBe("seek");
    expect(stanceOf({ siege: 4 }, false)).toBe("siege");
    expect(stanceOf({}, false)).toBe("guard");
    expect(stanceOf({}, true)).toBe("camp");
  });

  it("scores the attacker first, spreads melee claims and keeps targets with hysteresis", () => {
    const base = { attackedMe: false, claims: 0, distance: 3, health: 1, inReach: false, mounted: false };
    expect(targetScore({ ...base, attackedMe: true }, false)).toBeLessThan(targetScore(base, false));
    expect(targetScore({ ...base, claims: 3 }, false)).toBeGreaterThan(targetScore({ ...base, distance: 5 }, false));
    expect(targetScore({ ...base, claims: 2, mounted: true }, false)).toBeGreaterThan(targetScore(base, false));
    expect(shouldSwitchTarget(4, 3)).toBe(false);
    expect(shouldSwitchTarget(4, 2)).toBe(true);
    expect(isRescoreTick(3, 5, false)).toBe(true);
    expect(isRescoreTick(3, 6, false)).toBe(false);
    expect(isRescoreTick(3, 6, true)).toBe(true);
  });

  it("soldiers and civilian workers pass through each other; soldiers, horses and riders still collide", () => {
    const person = (job: string) => ({ job } as SettlementActor);
    expect(isMilitaryPassThrough(person("Soldier"), person("Carrier"))).toBe(true);
    expect(isMilitaryPassThrough(person("Woodcutter"), person("Soldier"))).toBe(true);
    expect(isMilitaryPassThrough(person("Soldier"), person("Soldier"))).toBe(false);
    expect(isMilitaryPassThrough(person("Soldier"), person("Mount"))).toBe(false);
    expect(isMilitaryPassThrough(person("Carrier"), person("Builder"))).toBe(false);
  });

  it("two riders side by side need about 1.1 tiles, nose to tail a horse's length", () => {
    const rider = (x: number, z: number) => ({ mounted: true, x, yaw: 0, z } as SettlementActor);
    expect(actorSeparation(rider(0, 0), rider(1.2, 0))).toBeCloseTo(1.1);
    expect(actorSeparation(rider(0, 0), rider(0, 2.5))).toBeCloseTo(2.1);
  });

  it("an archer retreats straight away first and finds no way out of a dead end", () => {
    const step = archerRetreatStep({ x: 5, z: 5 }, { x: 6, z: 5 }, () => true)!;
    expect(step.x).toBeLessThan(5);
    expect(archerRetreatStep({ x: 5, z: 5 }, { x: 6, z: 5 }, () => false)).toBeNull();
  });

  it("checks intermediate retreat clearance and the full body of a nearby rider", () => {
    let world!: WorldData;
    battle(candidate => { world = candidate; });
    const actor = { job: "Soldier", phase: "militaryField", visible: true, x: 24, z: 24 } as SettlementActor;
    const blocker = { ...actor, x: 23.65 };
    const context = { actors: [actor, blocker], buildings: [], occupied: new Uint8Array(SIZE ** 2),
      options: { world } } as unknown as SettlementContext;
    expect(isArcherRetreatClear(context, actor, { x: 23.3, z: 24 })).toBe(false);
    Object.assign(blocker, { mounted: true, x: 22.5 });
    expect(isArcherRetreatClear(context, actor, { x: 23.3, z: 24 })).toBe(false);
    blocker.mounted = false;
    expect(isArcherRetreatClear(context, actor, { x: 23.3, z: 24 })).toBe(true);
    Object.assign(blocker, { x: 24.2 });
    // Initial compression may be escaped in the direction of increasing separation.
    expect(isArcherRetreatClear(context, actor, { x: 23.3, z: 24 })).toBe(true);
  });

  it("the spatial grid answers like a brute-force scan, in the same order every time", () => {
    let seed = 7;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const points = Array.from({ length: 300 }, (_, id) => ({ id, x: random() * 64, z: random() * 64 }));
    const grid = createMilitarySpatialGrid<typeof points[number]>(64, 64);
    grid.rebuild(points);
    for (let query = 0; query < 50; query++) {
      const x = random() * 64, z = random() * 64, radius = 1 + random() * 12;
      const within: number[] = [];
      grid.forEachWithin(x, z, radius, () => true, point => within.push(point.id));
      const brute = points.filter(point => Math.hypot(point.x - x, point.z - z) <= radius).map(point => point.id);
      expect(within.sort((a, b) => a - b)).toEqual(brute);
      const nearest = grid.nearest(x, z, radius, point => point.id % 2 === 0);
      const expected = points.filter(point => point.id % 2 === 0 && Math.hypot(point.x - x, point.z - z) <= radius)
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      expect(nearest?.id).toBe(expected?.id);
      expect(grid.anyWithin(x, z, radius, () => true)).toBe(brute.length > 0);
    }
  });
});

describe("battle AI in the simulation", () => {
  it("a move order strikes back when hit, then carries on; a retreat ignores everything", () => {
    for (const order of ["move", "retreat"] as const) {
      const { advance, body, distance, health, simulation, spawn } = battle();
      const walker = spawn({ x: 10, z: 24 }, "heavy", 1, 2);
      const guard = spawn({ x: 20, z: 24.6 }, "shield", 2);
      const destination = { x: 36, z: 24 };
      expect(simulation.commandMilitaryOpponent([walker], destination, 1, order)).toBe(true);
      advance(40);
      const struck = health(guard) < militaryHealth("shield", 0);
      expect(struck).toBe(order === "move");
      if (body(walker)) expect(distance(walker, destination)).toBeLessThan(1.5);
    }
  });

  it("saves a retreat order and drops the retired archer retreat budget of older saves", () => {
    const { simulation, spawn } = battle();
    const walker = spawn({ x: 10, z: 24 }, "archer", 1);
    simulation.commandMilitaryOpponent([walker], { x: 30, z: 24 }, 1, "retreat");
    const saved = simulation.saveState();
    const combat = saved.military!.soldiers.find(entry => entry.actor === walker)!.combat!;
    expect(combat.order).toBe("retreat");
    Object.assign(combat, { retreatDistance: 2.5, retreatOrigin: { x: 10, z: 24 } });
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    const reloaded = simulation.saveState().military!.soldiers.find(entry => entry.actor === walker)!.combat!;
    expect(reloaded).not.toHaveProperty("retreatDistance");
    expect(reloaded).not.toHaveProperty("retreatOrigin");
    expect(reloaded.order).toBe("retreat");
  });

  it("rejects a corrupt saved rally running flag", () => {
    const { simulation, spawn } = battle();
    const id = spawn({ x: 10, z: 24 }, "heavy", 1);
    const saved = simulation.saveState();
    const combat = saved.military!.soldiers.find(soldier => soldier.actor === id)!.combat!;
    Object.assign(combat, { rallyRunning: "running" });
    expect(simulation.loadState(saved)).toEqual({ ok: false, reason: "Invalid military combatant" });
  });

  it("an attack move diverts to fight a nearby enemy and resumes its march", () => {
    const { advance, body, distance, simulation, spawn } = battle();
    const walker = spawn({ x: 10, z: 24 }, "heavy", 1, 2);
    const picket = spawn({ x: 22, z: 27 }, "shield", 2);
    const destination = { x: 36, z: 24 };
    simulation.commandMilitaryOpponent([walker], destination, 1, "attackMove");
    advance(60);
    expect(body(picket)).toBeUndefined();
    expect(distance(walker, destination)).toBeLessThan(1.5);
  });

  it("an attack move that arrived seeks the nearest enemy its faction knows within 24 tiles", () => {
    const { advance, body, simulation, spawn } = battle();
    const hunter = spawn({ x: 10, z: 24 }, "heavy", 1, 2);
    const far = spawn({ x: 34, z: 24 }, "shield", 2);
    // A comrade 11 tiles off (its sight, beyond both camp radii) shows the far enemy to the hunter's faction.
    const spotter = spawn({ x: 34, z: 35 }, "shield", 1);
    const hold = pin(simulation, spotter);
    simulation.commandMilitaryOpponent([hunter], { x: 14, z: 24 }, 1, "attackMove");
    advance(90, hold);
    expect(body(far)).toBeUndefined();
  });

  it("an attack move that arrived ignores an enemy its faction does not see (A13 phase 3)", () => {
    const { advance, body, distance, simulation, spawn } = battle();
    const hunter = spawn({ x: 10, z: 24 }, "heavy", 1, 2);
    const far = spawn({ x: 34, z: 24 }, "shield", 2);
    simulation.commandMilitaryOpponent([hunter], { x: 14, z: 24 }, 1, "attackMove");
    advance(30);
    expect(body(far)).toBeDefined();
    expect(distance(hunter, { x: 14, z: 24 })).toBeLessThan(2);
  });

  it("camp guards engage near their camp and return to it", () => {
    const { advance, distance, simulation, spawn } = battle();
    const camp = { x: 24, z: 24 };
    const guard = spawn(camp, "heavy", 2, 2);
    const scout = spawn({ x: 31, z: 24 }, "cavalry", 1, 2);
    // It steps out to meet the scout (between blows it may step back a little: footwork).
    let left = 0;
    advance(3, () => { left = Math.max(left, distance(guard, camp)); });
    expect(left).toBeGreaterThan(.5);
    simulation.commandMilitaryOpponent([scout], { x: 44, z: 44 }, 1, "retreat");
    advance(30);
    expect(distance(guard, camp)).toBeLessThan(.6);
  });

  it("an idle soldier that is hit reacts and alerts idle comrades nearby", () => {
    const { advance, simulation, soldier, spawn } = battle();
    const archer = spawn({ x: 12, z: 24 }, "archer", 1);
    const victim = spawn({ x: 19, z: 24 }, "shield", 2);
    const comrade = spawn({ x: 19, z: 28 }, "shield", 2);
    const hold = pin(simulation, archer);
    let reacted = false;
    advance(8, () => {
      hold();
      reacted ||= soldier(victim)?.combat?.target === archer && soldier(comrade)?.combat?.target === archer;
    });
    expect(reacted).toBe(true);
  });

  it("a pressed archer backs away while it can and keeps its bow", () => {
    const { advance, body, distance, simulation, spawn } = battle();
    const archer = spawn({ x: 24, z: 24 }, "archer", 1);
    const enemy = spawn({ x: 25.2, z: 24 }, "heavy", 2);
    const hold = pin(simulation, enemy);
    const tools = new Set<string>();
    advance(4, () => { hold(); tools.add(body(archer)?.tool ?? "bow"); });
    expect(distance(archer, body(enemy)!)).toBeGreaterThanOrEqual(2);
    expect([...tools]).toEqual(["bow"]);
  });

  it("an archer's retreat episode looks to its goal, spends a budget and refills after a calm", () => {
    expect(archerThreatRadius(undefined, 2.2)).toBe(2.2);
    let episode = recordRetreatStep(undefined, ARCHER_RETREAT_BUDGET - .5);
    expect(archerThreatRadius(episode, 2.2)).toBe(ARCHER_RETREAT_GOAL);
    expect(canBackAway(episode)).toBe(true);
    episode = recordRetreatStep(episode, .5);
    expect(canBackAway(episode)).toBe(false);
    expect(calmRetreat(episode, ARCHER_RETREAT_CALM / 2)?.active).toBe(false);
    expect(calmRetreat(episode, ARCHER_RETREAT_CALM / 2)).toBeUndefined();
  });

  it("a pressed archer backs away until it has room, then stands and shoots at full damage", () => {
    const { advance, body, distance, health, simulation, soldier, spawn } = battle();
    const archer = spawn({ x: 24, z: 24 }, "archer", 1);
    const enemy = spawn({ x: 25.2, z: 24 }, "heavy", 2);
    const hold = pin(simulation, enemy);
    let pointBlank = false;
    advance(5, () => { hold(); pointBlank ||= soldier(archer)?.combat?.closeQuarters === true; });
    const room = distance(archer, body(enemy)!);
    // The pinned dummy still creeps a little after the archer stops.
    expect(room).toBeGreaterThanOrEqual(ARCHER_RETREAT_GOAL - .5);
    expect(room).toBeLessThan(ARCHER_RETREAT_GOAL + 1);
    // It stops there: no endless backing away from a foe that stays put.
    const stand = { ...body(archer)! };
    const before = health(enemy);
    advance(4, () => { hold(); pointBlank ||= soldier(archer)?.combat?.closeQuarters === true; });
    expect(distance(archer, stand)).toBeLessThan(.3);
    expect(pointBlank).toBe(false);
    // Full arrows: more than the half-damage point-blank shots could deal (18.75 x 0.9 x 0.5 each).
    expect(before - health(enemy)).toBeGreaterThan(MILITARY_PROFILES.archer.damage * .9 * .5 * 2);
  });

  it("a pursuer as fast as the archer does not make it kite forever", () => {
    const { advance, body, soldier, spawn } = battle();
    const archer = spawn({ x: 24, z: 24 }, "archer", 1);
    const enemy = spawn({ x: 25.4, z: 24 }, "shield", 2);
    // The pursuer never strikes (its swing would give the archer room); it only follows.
    let walked = 0, last = { ...body(archer)! }, cornered = false;
    advance(14, () => {
      const state = soldier(enemy)?.combat;
      if (state) state.cooldown = 10;
      const now = body(archer);
      if (!now) return;
      walked += Math.hypot(now.x - last.x, now.z - last.z); last = { ...now };
      cornered ||= soldier(archer)?.combat?.closeQuarters === true;
    });
    expect(walked).toBeLessThan(ARCHER_RETREAT_BUDGET + 1);
    expect(cornered).toBe(true);
    // The reduced-HP archer may fall to the pursuer; the no-endless-kiting bounds remain the check.
  });

  it("two riders pass each other abreast without stopping", () => {
    const { advance, distance, simulation, spawn } = battle();
    const east = spawn({ x: 12, z: 24 }, "cavalry", 1), west = spawn({ x: 36, z: 25.2 }, "cavalry", 1);
    simulation.commandMilitaryOpponent([east], { x: 36, z: 24 }, 1, "move");
    simulation.commandMilitaryOpponent([west], { x: 12, z: 25.2 }, 1, "move");
    advance(9);
    expect(distance(east, { x: 36, z: 24 })).toBeLessThan(.5);
    expect(distance(west, { x: 12, z: 25.2 })).toBeLessThan(.5);
  });

  it("a rider at a besieged door dismounts into a free place, fights on foot, then remounts", () => {
    const { advance, body, health, simulation, soldier } = battle();
    const site = placeHostileSite(simulation, 4, 30, 30);
    const guards = [0, 1].map(() => spawnAround(simulation, site.access, "shield"));
    expect(simulation.registerMilitaryGarrison(site.uid, guards, 1, 200)).toBe(true);
    simulation.receiveTroops([{ hp: militaryHealth("cavalry", 2), rank: 2, type: "cavalry" }]);
    simulation.callOutMilitary(["cavalry"], { x: 16, z: 16 });
    advance(40);
    const rider = simulation.militarySoldiers().find(entry => entry.combat?.type === "cavalry")!.actor;
    expect(simulation.siegeMilitary([rider], site.uid)).toBe(true);
    let dismounted = false, horseSeen = false, guardHurt = false;
    advance(60, () => {
      const state = soldier(rider)?.combat;
      dismounted ||= state?.dismounted === true && body(rider)?.mounted === false;
      horseSeen ||= simulation.horseFrames().some(frame => frame.id === state?.mount && frame.visible);
      guardHurt ||= guards.some(id => health(id) < militaryHealth("shield", 0));
    });
    expect(dismounted).toBe(true);
    expect(horseSeen).toBe(true);
    expect(guardHurt).toBe(true);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    // Nobody left to fight at the door (or the duel lost): an idle rider mounts again.
    advance(60);
    const state = soldier(rider)?.combat;
    if (state) {
      expect(state.dismounted).toBeUndefined();
      expect(body(rider)?.mounted).toBe(true);
    }
  });

  it("a cornered archer shoots its bow point-blank at half damage", () => {
    // A one-cell dead-end corridor: no way back behind the archer.
    const corridor = (world: WorldData) => {
      world.walkCost.fill(0);
      for (let x = 2; x < 30; x++) world.walkCost[24 * SIZE + x] = 10;
      for (let x = 2; x < 10; x++) for (let z = 2; z < 30; z++) world.walkCost[z * SIZE + x] = 10;
    };
    const { advance, body, health, simulation, soldier, spawn } = battle(corridor);
    // At the dead end itself: a retreat step would leave the corridor.
    const archer = spawn({ x: 29.6, z: 24.5 }, "archer", 1);
    const enemy = spawn({ x: 28.2, z: 24.5 }, "heavy", 2);
    const hold = pin(simulation, enemy);
    const before = health(enemy);
    let pointBlank = false;
    advance(5, () => { hold(); pointBlank ||= soldier(archer)?.combat?.closeQuarters === true; });
    expect(pointBlank).toBe(true);
    expect(body(archer)?.tool ?? "bow").toBe("bow");
    expect(health(enemy)).toBeLessThan(before);
    // Half of a full arrow at most: 18.75 damage x 0.9 (axeman armour) x 0.5.
    expect(before - health(enemy)).toBeLessThanOrEqual(MILITARY_PROFILES.archer.damage * .9 * .5 * 1.5 * 3 + 1e-6);
  });

  it.each(["props", "crowd"] as const)("a CPU archer fires when clear endpoints hide blocking %s", kind => {
    const origin = { x: 24, z: 24 };
    const { advance, body, health, simulation, soldier, spawn } = battle(world => {
      if (kind !== "props") return;
      const offsets = [0, .55, -.55, 1.1, -1.1];
      world.props = { ...world.props, count: offsets.length,
        types: new Uint8Array(offsets.length).fill(PROP.sapling),
        x: Float32Array.from(offsets, angle => origin.x - Math.cos(angle) * .35),
        z: Float32Array.from(offsets, angle => origin.z - Math.sin(angle) * .35),
        scale: new Float32Array(offsets.length).fill(.25) };
    });
    const archer = spawn(origin, "archer", 1);
    const enemy = spawn({ x: 25.3, z: 24 }, "heavy", 2);
    const blocker = kind === "crowd" ? spawn({ x: 23.6, z: 24 }, "shield", 1) : undefined;
    const before = health(enemy);
    let pointBlank = false;
    advance(1.2, () => {
      for (const id of [enemy, blocker]) {
        if (id === undefined) continue;
        pin(simulation, id)();
        soldier(id)!.combat!.attackTime = 10;
      }
      pointBlank ||= soldier(archer)?.combat?.closeQuarters === true;
    });
    expect(pointBlank).toBe(true);
    expect(body(archer)!.tool).toBe("bow");
    expect(before - health(enemy)).toBeGreaterThan(0);
    expect(before - health(enemy)).toBeLessThanOrEqual(MILITARY_PROFILES.archer.damage * .9 * .5);
  });
});
