import { describe, expect, it, vi } from "vitest";

import { createMilitaryArchery } from "../src/shared/settlement/military-archery";
import { catapultBoulderFlight } from "../src/shared/settlement/military-catapult";
import {
  catapultRollDamage, MARBLE_ROLL_DAMAGE, MARBLE_ROLL_HITS, MARBLE_ROLL_SPEED
} from "../src/shared/settlement/military-catapult-roll";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import type { MilitaryArrow } from "../src/shared/settlement/military-projectiles";
import { isPublicBuildingPointClear } from "../src/shared/settlement/settlement-building-navigation";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import { validateMilitarySave } from "../src/shared/settlement/settlement-military-state";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import type { AuditedRandom } from "../src/shared/settlement/simulation-random";
import { BLOCKING, PROP, type WorldData } from "../src/shared/world/world-data";

const SIZE = 32, LANE_Z = 10, LANDING_X = 8;
interface Scene { buildings?: SettlementBuilding[]; slope?: number; trees?: [number, number][]; waterFromX?: number }
interface Body { faction: number; id: number; x: number }

const sceneWorld = ({ slope = 0, trees = [], waterFromX }: Scene) => {
  const heights = new Float32Array((SIZE + 1) * (SIZE + 1));
  for (let z = 0; z <= SIZE; z++) for (let x = 0; x <= SIZE; x++) heights[z * (SIZE + 1) + x] = 10 + slope * x;
  const blocking = new Uint8Array(SIZE * SIZE);
  if (waterFromX !== undefined)
    for (let z = 0; z < SIZE; z++) for (let x = waterFromX; x < SIZE; x++) blocking[z * SIZE + x] = BLOCKING.water;
  const props = { count: trees.length, types: Uint8Array.from(trees.map(() => PROP.coniferTree)),
    x: Float32Array.from(trees.map(tree => tree[0])), z: Float32Array.from(trees.map(tree => tree[1])),
    y: new Float32Array(trees.length), scale: new Float32Array(trees.length).fill(1),
    rotation: new Float32Array(trees.length), form: new Uint8Array(trees.length), phase: new Uint8Array(trees.length) };
  return { blocking, cellsX: SIZE, cellsZ: SIZE, heights, props } as unknown as WorldData;
};

/** Plot cells of each building are occupied, as placement marks them. */
const createOccupied = (buildings: readonly SettlementBuilding[]) => {
  const occupied = new Uint8Array(SIZE * SIZE);
  for (const building of buildings)
    for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
      for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
        occupied[Math.floor(z) * SIZE + Math.floor(x)] = 1;
  return occupied;
};

const groundY = (scene: Scene, x: number) => 10 + (scene.slope ?? 0) * x;

/** A marble shot one flight away from landing at (8, 10), flying along +x. */
const marbleShot = (scene: Scene): MilitaryArrow => {
  const flight = catapultBoulderFlight("marble"), y = groundY(scene, LANDING_X);
  return { id: 0, shooter: 99, rank: 0, faction: 0, x: 2, y: y + 3, z: LANE_Z, vx: 6 / flight,
    vy: (-3 + .5 * 9.8 * flight * flight) / flight, vz: 0, age: 0,
    boulder: { kind: "marble", target: 1, x: LANDING_X, y, z: LANE_Z } };
};

const createScene = (scene: Scene, bodies: readonly Body[] = []) => {
  const world = sceneWorld(scene), soldiers = new Map<number, SettlementSoldier>();
  const actors = bodies.map(body => {
    soldiers.set(body.id, { actor: body.id, building: -3, rank: 0, stationed: false,
      combat: { type: "heavy", faction: body.faction, hp: 100, cooldown: 0 } });
    return { uid: body.id, x: body.x, y: groundY(scene, body.x), z: LANE_Z, visible: true,
      phase: "militaryField" } as SettlementActor;
  });
  const buildings = scene.buildings ?? [], occupied = createOccupied(buildings);
  const context = { actors, buildings, commander: undefined, occupied, options: { world }, playerNation: "roman" } as
    unknown as SettlementContext;
  const random = { at: () => () => .5 } as unknown as AuditedRandom;
  const archery = createMilitaryArchery(context, soldiers, random, id => actors.find(body => body.uid === id));
  archery.restore({ arrows: [marbleShot(scene)], nextArrow: 1 });
  const hit = vi.fn();
  const tick = (dt = .05) => archery.update(dt, actors, hit);
  return { archery, hit, tick };
};

const shot = (archery: ReturnType<typeof createMilitaryArchery>) => archery.arrows()[0]!;

/** Lands the shot and ticks until the ball has stopped; returns the roll distance. */
const rollToRest = (scene: Scene, bodies: readonly Body[] = []) => {
  const run = createScene(scene, bodies);
  run.tick(catapultBoulderFlight("marble"));
  for (let tick = 0; tick < 200 && shot(run.archery).boulder!.restAge === undefined; tick++) run.tick();
  return { ...run, distance: shot(run.archery).boulder!.roll!.distance, x: shot(run.archery).x };
};

describe("CAT-6 marble roll", () => {
  it("rolls four tiles on flat ground along its flight bearing, then rests", () => {
    const { archery, distance, x } = rollToRest({});
    expect(distance).toBeCloseTo(4, 6);
    expect(x).toBeCloseTo(LANDING_X + 4, 6);
    expect(shot(archery).z).toBe(LANE_Z);
    expect(shot(archery).boulder).toMatchObject({ restAge: 0, roll: { speed: 0 } });
  });

  it("rolls further downhill (capped near six tiles) and shorter uphill", () => {
    const downhill = rollToRest({ slope: -.25 }).distance, uphill = rollToRest({ slope: .25 }).distance;
    expect(downhill).toBeGreaterThan(5); expect(downhill).toBeLessThanOrEqual(6);
    expect(uphill).toBeGreaterThan(2.5); expect(uphill).toBeLessThan(3.5);
    expect(rollToRest({ slope: -.8 }).distance).toBeCloseTo(6, 9);
  });

  it("follows the terrain height while rolling", () => {
    const scene = { slope: -.25 }, run = createScene(scene);
    run.tick(catapultBoulderFlight("marble"));
    for (let tick = 0; tick < 10; tick++) run.tick();
    const ball = shot(run.archery);
    expect(ball.y).toBeCloseTo(groundY(scene, ball.x), 6);
  });

  it("stops before a building's footprint mask, a tree trunk and water", () => {
    const building = { uid: 5, construction: 1, x: 11, z: LANE_Z, width: 2, depth: 2 } as SettlementBuilding;
    expect(rollToRest({ buildings: [building] }).x).toBeLessThan(10);
    expect(rollToRest({ buildings: [building] }).distance).toBeGreaterThan(1.9);
    expect(rollToRest({ trees: [[10.5, LANE_Z]] }).x).toBeLessThan(10.5);
    expect(rollToRest({ waterFromX: 10 }).x).toBeLessThan(10);
  });

  it("stops at a finished house's real wall outline, not at its larger plot edge", () => {
    const plotEdge = 10, house = { uid: 5, typeId: 1, construction: 1, x: plotEdge + 2, z: LANE_Z, width: 4,
      depth: 4, rotation: 0, input: {}, output: {} } as unknown as SettlementBuilding;
    const scene = { buildings: [house] }, stop = rollToRest(scene).x;
    expect(stop).toBeGreaterThan(plotEdge);
    expect(stop).toBeLessThan(LANDING_X + 4 - 1e-6);
    const context = { buildings: [house], occupied: createOccupied([house]), options: { world: sceneWorld(scene) },
      playerNation: "roman" } as unknown as SettlementContext;
    expect(isPublicBuildingPointClear(context, { x: stop, z: LANE_Z }, .12)).toBe(true);
    expect(isPublicBuildingPointClear(context, { x: stop + .1, z: LANE_Z }, .12)).toBe(false);
  });

  it("hits at most three enemies, with damage falling with speed, never friends or a unit twice", () => {
    const bodies = [{ faction: 1, id: 1, x: LANDING_X }, { faction: 0, id: 2, x: 8.6 },
      ...[9, 9.6, 10.2, 10.8, 11.4].map((x, index) => ({ faction: 1, id: 10 + index, x }))];
    const { hit } = rollToRest({}, bodies);
    const victims = hit.mock.calls.map(call => (call[1] as SettlementSoldier).actor);
    expect(victims).toEqual([1, 10, 11, 12]);
    const maximum = militaryHealth("heavy", 0);
    const rollDamage = hit.mock.calls.slice(1).map(call => call[7] as number);
    expect(rollDamage).toHaveLength(MARBLE_ROLL_HITS);
    expect(rollDamage[0]).toBeLessThanOrEqual(maximum * MARBLE_ROLL_DAMAGE);
    expect(rollDamage[0]).toBeGreaterThan(rollDamage[1]!); expect(rollDamage[1]).toBeGreaterThan(rollDamage[2]!);
    expect(hit.mock.calls.slice(1).every(call => call[6] === false)).toBe(true);
    expect(catapultRollDamage(MARBLE_ROLL_SPEED)).toBe(.5);
    expect(catapultRollDamage(0)).toBe(0);
    expect(catapultRollDamage(MARBLE_ROLL_SPEED * 2)).toBe(.5);
  });

  it("restores a mid-roll save identically and validates the saved roll", () => {
    const bodies = [{ faction: 1, id: 10, x: 10 }, { faction: 1, id: 11, x: 11 }];
    const original = createScene({}, bodies);
    original.tick(catapultBoulderFlight("marble"));
    for (let tick = 0; tick < 6; tick++) original.tick();
    const saved = original.archery.save();
    expect(saved.arrows[0]!.boulder!.roll!.speed).toBeGreaterThan(0);
    const copy = createScene({}, bodies);
    copy.archery.restore(structuredClone(saved));
    for (let tick = 0; tick < 60; tick++) { original.tick(); copy.tick(); }
    expect(copy.archery.save()).toEqual(original.archery.save());
    expect(copy.hit.mock.calls.map(call => call[7])).toEqual(original.hit.mock.calls.slice(-copy.hit.mock.calls.length)
      .map(call => call[7]));
    const military = { randomState: 0, soldiers: [], targets: [], coinsAllowed: [], recruitTimers: [], trainTimers: [],
      combat: { doors: [], ...saved } };
    expect(validateMilitarySave(military, [], [])).toBeNull();
    military.combat.arrows[0]!.boulder!.roll!.hits = 4;
    expect(validateMilitarySave(military, [], [])).toBe("Invalid catapult boulder");
    military.combat.arrows[0]!.boulder!.roll!.hits = 0;
    military.combat.arrows[0]!.boulder!.kind = "basalt";
    expect(validateMilitarySave(military, [], [])).toBe("Invalid catapult boulder");
  });

  it("removes the stopped ball after the CAT-7 rest and sink", () => {
    const { archery, tick } = rollToRest({});
    tick(4.4);
    expect(archery.arrows()).toHaveLength(1);
    tick(.1);
    expect(archery.arrows()).toHaveLength(0);
  });

  it("leaves other kinds landing at rest without a roll", () => {
    for (const kind of [undefined, "basalt", "limestone"] as const) {
      const run = createScene({});
      const boulder = shot(run.archery).boulder!;
      if (kind) boulder.kind = kind; else delete boulder.kind;
      shot(run.archery).age = catapultBoulderFlight(kind) - catapultBoulderFlight("marble");
      run.tick(catapultBoulderFlight("marble"));
      expect(shot(run.archery).boulder).toMatchObject({ restAge: 0 });
      expect(shot(run.archery).boulder!.roll).toBeUndefined();
    }
  });
});
