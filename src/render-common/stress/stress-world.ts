import { WALK_COST } from "../../shared/world/generation/walkability";
import { sampleBilinear, sampleSmooth } from "../../shared/world/grid-geometry";
import { createRandom, deriveSeed, type Random } from "../../shared/world/rng";
import { BUILD, type WorldData } from "../../shared/world/world-data";

const STRESS_COUNTS = { buildings: 200, fish: 400, units: 300 } as const;
const UNIT_SPEED = 0.9;
const WANDER_RADIUS = 10;
const WINDMILL_SHARE = 3;

/** Moving things of the stress scenario as struct of arrays (renderers read them each frame). */
export interface StressEntities {
  buildings: {
    count: number;
    rotation: Float32Array;
    windmill: Uint8Array;
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
  };
  fish: {
    count: number;
    heading: Float32Array;
    phase: Float32Array;
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
  };
  units: {
    count: number;
    heading: Float32Array;
    phase: Float32Array;
    variant: Uint8Array;
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
  };
  update: (deltaSeconds: number, time: number) => void;
}

const isWalkable = (world: WorldData, x: number, z: number) => {
  if (x < 1 || z < 1 || x >= world.cellsX - 1 || z >= world.cellsZ - 1) return false;
  return world.walkCost[Math.floor(z) * world.cellsX + Math.floor(x)]! !== WALK_COST.blocked;
};

const findSpot = (world: WorldData, random: Random, accept: (x: number, z: number) => boolean) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const x = random() * world.cellsX;
    const z = random() * world.cellsZ;
    if (accept(x, z)) return { x, z };
  }
  return { x: world.start.x, z: world.start.z };
};

const createBuildings = (world: WorldData, random: Random) => {
  const count = STRESS_COUNTS.buildings;
  const buildings = {
    count,
    rotation: new Float32Array(count),
    windmill: new Uint8Array(count),
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count)
  };
  for (let index = 0; index < count; index += 1) {
    const spot = findSpot(world, random, (x, z) => {
      const build = world.buildClass[Math.floor(z) * world.cellsX + Math.floor(x)]!;
      return build >= BUILD.medium && build <= BUILD.large;
    });
    buildings.x[index] = Math.floor(spot.x) + 0.5;
    buildings.z[index] = Math.floor(spot.z) + 0.5;
    buildings.y[index] = sampleSmooth(
      world,
      world.heights,
      buildings.x[index]!,
      buildings.z[index]!
    );
    buildings.rotation[index] = Math.floor(random() * 4) * (Math.PI / 2);
    buildings.windmill[index] = index % WINDMILL_SHARE === 0 ? 1 : 0;
  }
  return buildings;
};

/** Units wander between random walkable targets; heading turns smoothly; phase drives the walk cycle. */
const createUnits = (world: WorldData, random: Random) => {
  const count = STRESS_COUNTS.units;
  const units = {
    count,
    heading: new Float32Array(count),
    phase: new Float32Array(count),
    variant: new Uint8Array(count),
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count)
  };
  const targets = new Float32Array(count * 2);
  const pickTarget = (index: number) => {
    const spot = findSpot(
      world,
      random,
      (x, z) =>
        isWalkable(world, x, z) &&
        Math.hypot(x - units.x[index]!, z - units.z[index]!) < WANDER_RADIUS
    );
    targets[index * 2] = spot.x;
    targets[index * 2 + 1] = spot.z;
  };
  for (let index = 0; index < count; index += 1) {
    const spot = findSpot(world, random, (x, z) => isWalkable(world, x, z));
    units.x[index] = spot.x;
    units.z[index] = spot.z;
    units.variant[index] = index % 4;
    units.phase[index] = random() * Math.PI * 2;
    pickTarget(index);
  }
  const update = (deltaSeconds: number) => {
    for (let index = 0; index < count; index += 1) {
      const dx = targets[index * 2]! - units.x[index]!;
      const dz = targets[index * 2 + 1]! - units.z[index]!;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.3) {
        pickTarget(index);
        continue;
      }
      const cost =
        world.walkCost[Math.floor(units.z[index]!) * world.cellsX + Math.floor(units.x[index]!)] ||
        10;
      const step = Math.min(distance, (UNIT_SPEED * deltaSeconds * 10) / cost);
      units.x[index] = units.x[index]! + (dx / distance) * step;
      units.z[index] = units.z[index]! + (dz / distance) * step;
      units.y[index] = sampleSmooth(world, world.heights, units.x[index]!, units.z[index]!);
      const target = Math.atan2(dz, dx);
      const turn = Math.atan2(
        Math.sin(target - units.heading[index]!),
        Math.cos(target - units.heading[index]!)
      );
      units.heading[index] = units.heading[index]! + turn * Math.min(1, deltaSeconds * 6);
      units.phase[index] = units.phase[index]! + step * 7;
    }
  };
  return { units, update };
};

/** Fish circle around a centre in deeper water, slightly below the surface. */
const createFish = (world: WorldData, random: Random) => {
  const count = STRESS_COUNTS.fish;
  const fish = {
    count,
    heading: new Float32Array(count),
    phase: new Float32Array(count),
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count)
  };
  const centres = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const spot = findSpot(
      world,
      random,
      (x, z) => sampleBilinear(world, world.waterDepth, x, z) > 1.2
    );
    centres.set([spot.x, spot.z, 0.8 + random() * 2.2], index * 3);
    fish.phase[index] = random() * Math.PI * 2;
  }
  const update = (time: number) => {
    for (let index = 0; index < count; index += 1) {
      const radius = centres[index * 3 + 2]!;
      const angle = time * (0.5 / radius) + fish.phase[index]!;
      fish.x[index] = centres[index * 3]! + Math.cos(angle) * radius;
      fish.z[index] = centres[index * 3 + 1]! + Math.sin(angle) * radius;
      fish.y[index] = -0.35;
      fish.heading[index] = angle + Math.PI / 2;
    }
  };
  return { fish, update };
};

export const createStressEntities = (world: WorldData): StressEntities => {
  const random = createRandom(deriveSeed(world.seed, "stress"));
  const buildings = createBuildings(world, random);
  const walkers = createUnits(world, random);
  const swimmers = createFish(world, random);
  return {
    buildings,
    fish: swimmers.fish,
    units: walkers.units,
    update: (deltaSeconds, time) => {
      walkers.update(Math.min(deltaSeconds, 0.1));
      swimmers.update(time);
    }
  };
};
