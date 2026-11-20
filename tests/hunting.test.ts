import { expect, it } from "vitest";

import { getIslandHuntingTargets } from "../src/app/settlement/island-hunting-targets";
import { createCamera } from "../src/render-common/camera-state";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { validateAnimalSave } from "../src/render-common/wildlife/manager/animal-save";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { MAX_PATH_POINTS } from "../src/render-common/wildlife/nav/nav-path";
import { ANIMAL_STATE, SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { getHuntValue } from "../src/render-common/wildlife/wildlife-stages";
import { huntingWorld } from "./helpers/hunting-world";

const place = (animals: ReturnType<typeof createAnimalManager>, x: number, z: number) => {
  const before = new Set(Array.from(animals.debug.pool.active.keys()).filter(id => animals.debug.pool.active[id]));
  expect(animals.placeAnimal(SPECIES.deer, x, z)).toBe(true);
  const id = animals.debug.pool.active.findIndex((active, id) => Boolean(active) && !before.has(id));
  animals.debug.pool.pending[id] = 0;
  animals.debug.pool.appear[id] = 1;
  return id;
};

it("hunts adults only and preserves the wounded escape across save/load", () => {
  const world = huntingWorld(), nav = createIslandNav(world, []);
  let animals = createAnimalManager(world, nav);
  const id = place(animals, 30, 30);
  expect(typeof id).toBe("number");
  const camera = createCamera(30, 30, 1);
  animals.update(0, camera);
  for (const age of [0, .2, .5]) {
    animals.setAgeNormalized(id, age);
    expect(getHuntValue(SPECIES.deer, age).isHuntable).toBe(false);
    expect(animals.hitHuntedAnimal(id, { x: 26, z: 30 })).toBe(false);
  }
  animals.setAgeNormalized(id, 1);
  expect(animals.hitHuntedAnimal(id, { x: 26, z: 30 })).toBe(true);
  const saved = JSON.parse(JSON.stringify(animals.saveState()));
  validateAnimalSave(saved);
  animals = createAnimalManager(world, nav, saved);
  expect(animals.debug.pool.health[id]).toBe(.5);
  for (let time = 1 / 30; time <= 12; time += 1 / 30) animals.update(time, camera);
  const pool = animals.debug.pool;
  expect(pool.huntState[id]).toBe(2);
  expect(Math.hypot(pool.x[id]! - 30, pool.z[id]! - 30)).toBeGreaterThan(9);
  expect(Math.hypot(pool.x[id]! - 30, pool.z[id]! - 30)).toBeLessThan(11);
  expect(animals.hitHuntedAnimal(id, { x: pool.x[id]! - 4, z: pool.z[id]! })).toBe(true);
  expect(pool.active[id]).toBe(0);
  expect(pool.carcass[id]).toBe(1);
});

it("scatters all nearby ages in different directions without hurting bystanders", () => {
  const world = huntingWorld(), animals = createAnimalManager(world, createIslandNav(world, []));
  const prey = place(animals, 30, 30);
  const nearby = [[30, 35], [30, 25], [35, 30]].map(([x, z]) => place(animals, x!, z!));
  const far = place(animals, 45, 30);
  animals.setAgeNormalized(prey, 1);
  animals.setAgeNormalized(nearby[0]!, .2);
  expect(animals.hitHuntedAnimal(prey, { x: 26, z: 30 })).toBe(true);
  const pool = animals.debug.pool;
  expect(nearby.map(id => pool.huntState[id])).toEqual([3, 3, 3]);
  expect(nearby.map(id => pool.health[id])).toEqual([1, 1, 1]);
  expect(pool.huntState[far]).toBe(0);
  const angles = nearby.map(id => Math.atan2(pool.targetZ[id]! - pool.z[id]!, pool.targetX[id]! - pool.x[id]!));
  expect(new Set(angles.map(angle => angle.toFixed(1))).size).toBeGreaterThan(1);
});

it("finishes a saved wounded escape from rest near its endpoint while offscreen animals live on", () => {
  const world = huntingWorld(), nav = createIslandNav(world, []);
  let animals = createAnimalManager(world, nav);
  const prey = place(animals, 30, 30), offscreen = place(animals, 20, 20);
  animals.setAgeNormalized(prey, 1);
  expect(animals.hitHuntedAnimal(prey, { x: 26, z: 30 })).toBe(true);
  const pool = animals.debug.pool;
  // Actual supplied saves contained a stopped wounded animal0.164 tiles from its endpoint:
  // braking stopped at0.25, outside the0.15 waypoint-admission radius.
  pool.x[prey] = pool.targetX[prey]! - .164;
  pool.z[prey] = pool.targetZ[prey]!;
  pool.pathIndex[prey] = pool.pathCount[prey]! - 1;
  pool.speed[prey] = 0;
  pool.state[offscreen] = ANIMAL_STATE.idle;
  pool.stateTime[offscreen] = 0;
  const saved = JSON.parse(JSON.stringify(animals.saveState()));
  validateAnimalSave(saved);
  animals = createAnimalManager(world, nav, saved);
  const camera = createCamera(1000, 1000, 1);
  animals.update(0, camera);
  for (let tick = 1; tick <= 180; tick++) animals.update(tick / 30, camera);
  const restored = animals.debug.pool;
  expect(restored.huntState[prey]).toBe(2);
  expect(restored.stateTime[offscreen]).toBeGreaterThan(0);
  expect(restored.health[prey]).toBe(.5);
  expect(animals.hitHuntedAnimal(prey, { x: restored.x[prey]! - 4, z: restored.z[prey]! })).toBe(true);
  for (let tick = 181; tick <= 360; tick++) animals.update(tick / 30, camera);
  expect(animals.isCarcass(prey)).toBe(true);
  expect(animals.harvestCarcass(prey)).toBe(true);
  expect(animals.harvestCarcass(prey)).toBe(false);
  expect(restored.active[offscreen]).toBe(1);
});

it("finishes a curved wounded route that initially passes close to its final endpoint", () => {
  const world = huntingWorld(), nav = createIslandNav(world, []);
  let animals = createAnimalManager(world, nav);
  const prey = place(animals, 30, 30), pool = animals.debug.pool;
  animals.setAgeNormalized(prey, 1);
  pool.huntState[prey] = 1; pool.health[prey] = .5;
  pool.state[prey] = ANIMAL_STATE.flee; pool.stateLength[prey] = Infinity;
  pool.heading[prey] = Math.PI / 2; pool.desiredHeading[prey] = Math.PI / 2;
  pool.targetX[prey] = 30.04; pool.targetZ[prey] = 30;
  pool.path.set([32, 30, 32, 32, 30.04, 30], prey * MAX_PATH_POINTS * 2);
  pool.pathCount[prey] = 3; pool.pathIndex[prey] = 0; pool.speed[prey] = 0;
  const saved = JSON.parse(JSON.stringify(animals.saveState()));
  validateAnimalSave(saved);
  animals = createAnimalManager(world, nav, saved);
  const camera = createCamera(1000, 1000, 1);
  animals.update(0, camera);
  for (let tick = 1; tick <= 600; tick++) animals.update(tick / 30, camera);
  expect(animals.debug.pool.huntState[prey]).toBe(2);
  expect(animals.debug.pool.health[prey]).toBe(.5);
  expect(animals.hitHuntedAnimal(prey, { x: 26, z: 30 })).toBe(true);
});

it("snapshots only real living huntable animals without reserving or mutating the native population", () => {
  const world = huntingWorld();
  const animals = createAnimalManager(world, createIslandNav(world, []));
  const pending = place(animals, 25, 30);
  const juvenile = place(animals, 30, 30);
  const adult = place(animals, 35, 30);
  animals.setAgeNormalized(pending, 1);
  animals.debug.pool.pending[pending] = 1;
  animals.setAgeNormalized(juvenile, .2);
  animals.setAgeNormalized(adult, 1);
  const before = JSON.stringify(animals.saveState());
  const targets = getIslandHuntingTargets(animals);
  expect(targets.find(target => target.id === pending)).toBeUndefined();
  expect(targets.find(target => target.id === juvenile)).toBeUndefined();
  const target = targets.find(target => target.id === adult)!;
  expect(target).toEqual({ id: adult, kind: "wildlife", x: 35, z: 30 });
  expect(JSON.stringify(animals.saveState())).toBe(before);
  target.x = -100;
  expect(animals.debug.pool.x[adult]).toBe(35);
  animals.killAnimal(adult);
  expect(getIslandHuntingTargets(animals).some(item => item.id === adult)).toBe(false);
});
