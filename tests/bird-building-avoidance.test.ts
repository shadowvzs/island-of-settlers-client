import { Box3, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { createBirdBuildingAvoidance } from "../src/render-common/birds/bird-building-avoidance";
import { getBirdBuildingBounds } from "../src/render-common/birds/bird-building-bounds";
import { createFlock, findPerch, updateFlock } from "../src/render-common/birds/bird-flock";
import { createHabitatField } from "../src/render-common/birds/bird-habitat";
import { createBirdManager } from "../src/render-common/birds/bird-manager";
import { updateBird } from "../src/render-common/birds/bird-motion";
import { createBirdPool } from "../src/render-common/birds/bird-pool";
import { BIRD_SPECIES } from "../src/render-common/birds/bird-species";
import { createViewRegion } from "../src/render-common/birds/bird-view";
import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createCamera } from "../src/render-common/camera-state";
import { BEHAVIOUR } from "../src/render-common/critters/critter-colonies";
import { CRITTER } from "../src/render-common/critters/critter-species";
import { createCritterTerrain } from "../src/render-common/critters/habitat/critter-terrain";
import { CLIP } from "../src/render-common/critters/model/critter-model";
import { createCritterBuildingFlight, getCritterBirdFlightEnvelope } from
  "../src/render-common/critters/sim/critter-building-flight";
import type { CritterContext } from "../src/render-common/critters/sim/critter-context";
import { createCritterPool } from "../src/render-common/critters/sim/critter-pool";
import { SOAR_MODE, updateSoarer } from "../src/render-common/critters/sim/critter-soar";
import { STALK_MODE, updateStalker } from "../src/render-common/critters/sim/critter-stalk";
import { computeEnvironment } from "../src/render-common/environment";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createRandom } from "../src/shared/world/rng";
import { FOG } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 1000 });
world.fog.fill(FOG.visible);
const field = createHabitatField(world);
field.canopy.fill(0); field.forest.fill(0); field.grass.fill(1); field.open.fill(1);
field.water.fill(0); field.surface = () => 0;
const fixture = { uid: 1, typeId: 2, x: 0, y: 0, z: 0, rotation: 0 };

describe("birds avoid occupied building airspace", () => {
  it.each(BIRD_SPECIES.map((_, index) => index))("keeps species %s moving past the HQ crown without hovering or teleporting", species => {
    const buildings = createBirdBuildingAvoidance(); buildings.refresh([fixture]);
    const box = getBirdBuildingBounds(fixture), traits = BIRD_SPECIES[species]!, radius = traits.size * .6;
    const flock = createFlock();
    Object.assign(flock, { active: true, species, x: box.minX - radius - .1, y: box.maxY - .55,
      z: box.maxZ - .35, speed: traits.speed, course: 0, heading: 0, flightLeft: 100,
      courseTimer: 100, cruise: box.maxY - .55 });
    const pool = createBirdPool(1);
    pool.flock[0] = 0; pool.species[0] = species; pool.x[0] = flock.x; pool.y[0] = flock.y;
    pool.z[0] = flock.z; pool.speed[0] = traits.speed; pool.speedFactor[0] = 1;
    pool.rateFactor[0] = 1; pool.appear[0] = 1; pool.flapBoost[0] = 1; pool.glideTimer[0] = 100;
    const canopy = { ...field, canopy: new Float32Array(field.canopy.length).fill(box.maxY - .7) };
    const context = { buildings, field: canopy, random: createRandom(42), step: 1 / 30, time: 0 };
    const leader = { ...context, activity: 1, noise: () => 0, region: createViewRegion() };
    leader.region.halfU = 100; leader.region.halfV = 100;
    const initial = { x: flock.x, y: flock.y, z: flock.z };
    let stopped = 0, longestStop = 0;
    for (let tick = 0; tick < 180; tick++) {
      context.time = leader.time = tick / 30;
      const before = { x: pool.x[0]!, y: pool.y[0]!, z: pool.z[0]! };
      updateFlock(flock, leader); updateBird(pool, 0, flock, context);
      const after = { x: pool.x[0]!, y: pool.y[0]!, z: pool.z[0]! };
      const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
      stopped = moved < .001 ? stopped + 1 : 0; longestStop = Math.max(longestStop, stopped);
      expect(moved).toBeLessThan(.24);
      expect(buildings.clear(after, radius)).toBe(true);
    }
    expect(longestStop).toBeLessThan(6);
    expect(Math.hypot(pool.x[0]! - initial.x, pool.z[0]! - initial.z)).toBeGreaterThan(2);
  });
  it("reserves the actual High and Minimal architecture and revolving sails at every rotation", () => {
    const material = new MeshStandardMaterial();
    const materials = Object.fromEntries(["mosaic", "rope", "paint", "plaster", "stone", "wood", "roof", "steel",
      "iron", "cloth", "leaf", "dark", "gold", "bark", "endgrain", "fish", "sacking", "straw", "amber"]
      .map(surface => [surface, material])) as Record<BuildingSurface, MeshStandardMaterial>;
    for (const definition of BUILDING_CATALOG) for (const detailed of [true, false]) {
      const model = createRomanBuilding(definition, materials, detailed); model.fitToGrid();
      for (let rotation = 0; rotation < 4; rotation++) {
        model.root.rotation.y = rotation * Math.PI / 2; model.root.updateMatrixWorld(true);
        const actual = new Box3();
        model.root.traverse(object => {
          if (!(object instanceof Mesh)) return;
          for (let parent = object.parent; parent; parent = parent.parent)
            if (parent.name === "furnace_effects") return;
          actual.expandByObject(object);
        });
        const reserved = getBirdBuildingBounds({ ...fixture, typeId: definition.id, rotation });
        expect(reserved.minX, `${definition.id}/minX`).toBeLessThanOrEqual(actual.min.x + .015);
        expect(reserved.maxX, `${definition.id}/maxX`).toBeGreaterThanOrEqual(actual.max.x - .015);
        expect(reserved.minZ, `${definition.id}/minZ`).toBeLessThanOrEqual(actual.min.z + .015);
        expect(reserved.maxZ, `${definition.id}/maxZ`).toBeGreaterThanOrEqual(actual.max.z - .015);
        expect(reserved.maxY, `${definition.id}/maxY`).toBeGreaterThanOrEqual(actual.max.y - .015);
      }
      model.dispose();
    }
    material.dispose();
  });
  for (let species = 0; species < BIRD_SPECIES.length; species++) {
    it(`steers species ${species} around a building without crossing it or stopping its wings`, () => {
      const buildings = createBirdBuildingAvoidance(); buildings.refresh([fixture]);
      const box = getBirdBuildingBounds(fixture), traits = BIRD_SPECIES[species]!, radius = traits.size * .6;
      const flock = createFlock();
      Object.assign(flock, { active: true, species, x: box.minX - radius - 2, y: 1.5, z: 0,
        speed: traits.speed, course: 0, heading: 0, flightLeft: 100, courseTimer: 100, cruise: 1.5 });
      const pool = createBirdPool(1);
      pool.flock[0] = 0; pool.species[0] = species; pool.x[0] = flock.x; pool.y[0] = flock.y;
      pool.speed[0] = traits.speed; pool.speedFactor[0] = 1; pool.rateFactor[0] = 1;
      pool.appear[0] = 1; pool.flapBoost[0] = 1; pool.glideTimer[0] = 100;
      const initial = pool.x[0]!, context = { buildings, field, random: createRandom(42), step: 1 / 30, time: 0 };
      const flockContext = { ...context, activity: 1, noise: () => 0, region: createViewRegion() };
      flockContext.region.halfU = 100; flockContext.region.halfV = 100;
      let banked = false;
      for (let step = 0; step < 600; step++) {
        context.time = step / 30; flockContext.time = context.time;
        updateFlock(flock, flockContext); updateBird(pool, 0, flock, context);
        expect(buildings.clear({ x: pool.x[0]!, y: pool.y[0]!, z: pool.z[0]! }, radius)).toBe(true);
        banked ||= Math.abs(pool.bank[0]!) > .05;
      }
      expect(Math.hypot(pool.x[0]! - initial, pool.z[0]!)).toBeGreaterThan(3);
      expect(banked).toBe(true); expect(pool.phase[0]).not.toBe(0);
    });
  }
  it("rejects a landing in a building and restores the perch after demolition", () => {
    const buildings = createBirdBuildingAvoidance();
    const context = { buildings, field, random: () => .5, step: 1 / 30, time: 0,
      activity: 1, noise: () => 0, region: createViewRegion() };
    const flock = createFlock(); flock.species = 0; flock.x = 20; flock.z = 20;
    expect(findPerch(flock, context)).not.toBeNull();
    buildings.refresh([{ ...fixture, x: 28, z: 20 }]); expect(findPerch(flock, context)).toBeNull();
    expect(buildings.refresh([{ ...fixture, x: 28, z: 20 }])).toBe(false);
    buildings.refresh([]); expect(findPerch(flock, context)).not.toBeNull();
  });
  it("checks a swept step even when both endpoints are outside a narrow building", () => {
    const buildings = createBirdBuildingAvoidance(); buildings.refresh([{ ...fixture, typeId: 35 }]);
    const from = { x: -5, y: .8, z: 0 }, to = { x: 5, y: .8, z: 0 };
    buildings.move(from, to, .3); expect(to.x).toBe(-5);
  });
  it("new construction clears existing birds before interpolation, and demolition releases airspace", () => {
    let live: typeof fixture[] = [];
    const manager = createBirdManager(world, { getBuildings: () => live });
    const camera = createCamera(world.start.x, world.start.z, .7);
    camera.viewportWidth = 1200; camera.viewportHeight = 850;
    const day = computeEnvironment(world.sun, 12, 0);
    let time = 0, frame = manager.update(time, camera, day);
    for (; time < 60 && !frame.count; time += 1 / 30) frame = manager.update(time, camera, day);
    expect(frame.count).toBeGreaterThan(0);
    live = [{ ...fixture, x: frame.x[0]!, y: frame.y[0]! - 1, z: frame.z[0]! }];
    frame = manager.update(time, camera, day);
    const buildings = createBirdBuildingAvoidance(); buildings.refresh(live);
    for (let bird = 0; bird < frame.count; bird++) expect(buildings.clear({ x: frame.x[bird]!,
      y: frame.y[bird]!, z: frame.z[bird]! }, BIRD_SPECIES[frame.species[bird]!]!.size * .6)).toBe(true);
    live = []; manager.update(time + 1 / 30, camera, day);
  });
});

describe("herons, gulls, and eagles share building flight clearance", () => {
  it("preserves a soaring bird's natural descending bob when no building blocks its flight", () => {
    const buildings = createBirdBuildingAvoidance(), pool = createCritterPool(1);
    pool.active[0] = 1; pool.species[0] = CRITTER.eagle; pool.scale[0] = 1;
    pool.behaviour[0] = BEHAVIOUR.soar; pool.clip[0] = CLIP.air;
    pool.y[0] = 3; pool.lift[0] = 3;
    const flight = createCritterBuildingFlight(pool, buildings);
    flight.remember(0);
    pool.x[0] = .05; pool.y[0] = 2.98;
    flight.finish(0);
    expect(pool.x[0]).toBeCloseTo(.05); expect(pool.y[0]).toBeCloseTo(2.98);
    expect(pool.lift[0]).toBeCloseTo(3);
  });
  for (const species of [CRITTER.heron, CRITTER.gull, CRITTER.eagle]) it(`protects species ${species}`, () => {
    const buildings = createBirdBuildingAvoidance(); buildings.refresh([fixture]);
    const pool = createCritterPool(1), envelope = getCritterBirdFlightEnvelope(species)!;
    pool.active[0] = 1; pool.species[0] = species; pool.scale[0] = 1.3; pool.seed[0] = .2;
    pool.site[0] = 0;
    pool.x[0] = getBirdBuildingBounds(fixture).minX - envelope.radius * 1.3 - 1;
    pool.y[0] = pool.lift[0] = 1.5; pool.timer[0] = 100; pool.clock[0] = 100;
    pool.behaviour[0] = species === CRITTER.eagle ? BEHAVIOUR.soar : BEHAVIOUR.shore;
    pool.clip[0] = species === CRITTER.eagle ? CLIP.air : CLIP.fly;
    pool.mode[0] = species === CRITTER.eagle ? SOAR_MODE.glide : STALK_MODE.fly;
    pool.originZ[0] = 3; pool.originX[0] = Math.PI; pool.targetX[0] = pool.x[0]! + 3;
    const terrain = createCritterTerrain(world, field); terrain.ground = () => 0; terrain.depth = () => 0;
    const context: CritterContext = { buildings, daylight: 1, emitRipple: () => {}, findThreat: () => null,
      leaveSite: () => {}, nav: null, random: createRandom(7), step: 1 / 30, time: 0, terrain, trees: null,
      sites: [{ colony: 0, food: false, members: [species], roll: 0, seed: 0, x: 0, y: 0, z: 0 }] };
    const flight = createCritterBuildingFlight(pool, buildings);
    for (let step = 0; step < 600; step++) {
      context.time = step / 30; flight.recover(0); flight.remember(0);
      if (species === CRITTER.eagle) updateSoarer(pool, 0, context);
      else updateStalker(pool, 0, context);
      flight.finish(0); flight.recover(0);
      expect(buildings.clear({ x: pool.x[0]!, y: pool.y[0]! + envelope.height * 1.3,
        z: pool.z[0]! }, envelope.radius * 1.3)).toBe(true);
    }
    if (species === CRITTER.eagle) expect(pool.originZ[0]).toBe(3);
    else expect(pool.pose[0]).toBeGreaterThan(1);
  });
});
