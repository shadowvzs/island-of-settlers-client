import { describe, expect, it } from "vitest";

import { createHabitatField } from "../src/render-common/birds/bird-habitat";
import { createViewRegion, isInView, updateViewRegion } from "../src/render-common/birds/bird-view";
import {
  BUTTERFLY_MIN_ZOOM,
  getButterflyActivity,
  getButterflyCap,
  getButterflyVariant,
  getDesiredButterflies,
  getWingAngle,
  getWingBend
} from "../src/render-common/butterflies/butterfly-flight";
import {
  createButterflyField,
  findFlower,
  getFlowerTop,
  scoreButterflyZone
} from "../src/render-common/butterflies/butterfly-habitat";
import {
  BUTTERFLY_CAPACITY,
  createButterflyManager
} from "../src/render-common/butterflies/butterfly-manager";
import {
  createButterflyGeometry,
  deformButterflyPoint
} from "../src/render-common/butterflies/butterfly-mesh";
import { startFlying, updateButterfly } from "../src/render-common/butterflies/butterfly-motion";
import {
  BUTTERFLY_MODE,
  createButterflyPool
} from "../src/render-common/butterflies/butterfly-pool";
import { BUTTERFLY_SPECIES } from "../src/render-common/butterflies/butterfly-species";
import { createCamera } from "../src/render-common/camera-state";
import { computeEnvironment } from "../src/render-common/environment";
import { createFlyerAtlas } from "../src/render-common/flyers/flyer-atlas";
import { getButterflyCell } from "../src/render-common/flyers/flyer-atlas-layout";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createRandom } from "../src/shared/world/rng";
import { FOG, PROP, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const createWorld = () => {
  const world = cachedWorld({
    ...DEFAULT_WORLD_OPTIONS,
    cellsX: 64,
    cellsZ: 64,
    erosionDroplets: 4000
  });
  world.fog.fill(FOG.visible);
  return world;
};

const createField = (world: WorldData) => createButterflyField(world, createHabitatField(world));

/** A flower prop on open meadow (the best landing / spawn test spot). */
const findMeadowFlower = (world: WorldData, field: ReturnType<typeof createField>) => {
  const { props } = world;
  for (let prop = 0; prop < props.count; prop += 1) {
    if (props.types[prop] !== PROP.flowers) continue;
    if (scoreButterflyZone(field, BUTTERFLY_SPECIES, props.x[prop]!, props.z[prop]!) > 0.2)
      return prop;
  }
  return -1;
};

describe("butterfly caps and conditions", () => {
  it("is off when zoomed out and capped hard nearer", () => {
    expect(getButterflyCap(0.2)).toBe(0);
    expect(getButterflyCap(BUTTERFLY_MIN_ZOOM - 0.01)).toBe(0);
    expect(getButterflyCap(1)).toBeGreaterThan(0);
    expect(getButterflyCap(1.5)).toBeLessThanOrEqual(3);
    expect(getButterflyCap(3)).toBe(3);
    expect(getButterflyCap(3)).toBeLessThanOrEqual(BUTTERFLY_CAPACITY);
    for (let zoom = 0.75; zoom < 3; zoom += 0.05)
      expect(getButterflyCap(zoom + 0.05)).toBeGreaterThanOrEqual(getButterflyCap(zoom));
  });

  it("flies by day only and never in rain", () => {
    const sun = { azimuthX: 0.6, azimuthZ: -0.8, elevation: 0.8 };
    expect(getButterflyActivity(computeEnvironment(sun, 12, 0))).toBeCloseTo(1);
    expect(getButterflyActivity(computeEnvironment(sun, 0, 0))).toBe(0);
    expect(getButterflyActivity(computeEnvironment(sun, 12, 0.3))).toBe(0);
    expect(getDesiredButterflies(3, 0)).toBe(0);
    expect(getDesiredButterflies(1, 1)).toBe(getButterflyCap(1));
  });
});

describe("butterfly zones", () => {
  const world = createWorld();
  const field = createField(world);

  it("likes flowery meadows and avoids water and hidden fog", () => {
    const flower = findMeadowFlower(world, field);
    expect(flower).toBeGreaterThanOrEqual(0);
    let water = -1;
    for (let vertex = 0; vertex < world.waterDepth.length && water < 0; vertex += 1)
      if (world.waterDepth[vertex]! > 1) water = vertex;
    const waterX = water % (world.cellsX + 1);
    const waterZ = Math.floor(water / (world.cellsX + 1));
    expect(scoreButterflyZone(field, BUTTERFLY_SPECIES, waterX, waterZ)).toBe(0);
    expect(scoreButterflyZone(field, BUTTERFLY_SPECIES, -5, 10)).toBe(0);
    const hidden = { ...world, fog: new Uint8Array(world.fog.length).fill(FOG.hidden) };
    const hiddenField = createField(hidden);
    const { x, z } = world.props;
    expect(scoreButterflyZone(hiddenField, BUTTERFLY_SPECIES, x[flower]!, z[flower]!)).toBe(0);
  });

  it("finds the nearest flower and can skip the last one", () => {
    const flower = findMeadowFlower(world, field);
    const { x, z } = world.props;
    expect(findFlower(field, x[flower]! + 0.3, z[flower]!, 3, -1)).toBe(flower);
    expect(findFlower(field, x[flower]! + 0.3, z[flower]!, 3, flower)).not.toBe(flower);
  });
});

describe("butterfly flight", () => {
  it("beats between the down stroke and closed, glides flat, basks slowly", () => {
    for (let phase = 0; phase < Math.PI * 2; phase += 0.1) {
      const flight = getWingAngle(phase, 1, 0);
      expect(flight).toBeGreaterThanOrEqual(-0.4);
      expect(flight).toBeLessThanOrEqual(1.4);
      expect(getWingAngle(phase, 0, 0)).toBeCloseTo(0.15);
      expect(getWingAngle(phase, 1, 1)).toBeGreaterThanOrEqual(0.29);
    }
  });

  it("turns only the wings about the body axis", () => {
    const out = new Float32Array(3);
    deformButterflyPoint(0.1, 0, 0.4, 1, { angle: 1.2, bend: 0 }, out, 0);
    expect(out[1]).toBeGreaterThan(0.3);
    expect(Math.hypot(out[1]!, out[2]!)).toBeCloseTo(0.4);
    deformButterflyPoint(0.1, 0.02, 0.01, 0, { angle: 1.2, bend: 0 }, out, 0);
    expect([...out]).toEqual([0.1, 0.02, 0.01].map(Math.fround));
  });

  it("bends the wing tips and the hindwing behind the beat", () => {
    const straight = new Float32Array(3);
    const bent = new Float32Array(3);
    deformButterflyPoint(0, 0, 0.45, 1, { angle: 0.3, bend: 0 }, straight, 0);
    deformButterflyPoint(0, 0, 0.45, 1, { angle: 0.3, bend: 0.3 }, bent, 0);
    expect(bent[1]!).toBeGreaterThan(straight[1]!);
    deformButterflyPoint(0, 0, 0.02, 1, { angle: 0.3, bend: 0.3 }, bent, 0);
    deformButterflyPoint(0, 0, 0.02, 1, { angle: 0.3, bend: 0 }, straight, 0);
    expect(bent[1]!).toBeCloseTo(straight[1]!, 3);
    expect(getWingBend(Math.PI, 1, 0)).toBeGreaterThan(0);
    expect(getWingBend(1, 0, 0)).toBeCloseTo(0);
  });

  it("builds a light mesh with atlas UVs and per butterfly variants", () => {
    BUTTERFLY_SPECIES.forEach((_, species) => {
      const geometry = createButterflyGeometry(species);
      expect(geometry.sides.length / 3).toBeLessThan(200);
      for (const uv of geometry.upperUv) expect(uv === -1 || (uv >= 0 && uv <= 1)).toBe(true);
    });
    const variants = new Set(
      Array.from({ length: 40 }, (_, seed) => getButterflyVariant(seed / 4, 3))
    );
    expect(variants.size).toBe(3);
  });

  it("lands on a nearby flower, sits with slow wings, then flies on", () => {
    const world = createWorld();
    const field = createField(world);
    const flower = findMeadowFlower(world, field);
    const pool = createButterflyPool(4);
    const context = { field, random: createRandom(7), step: 1 / 30, time: 0 };
    pool.active[0] = 1;
    pool.x[0] = world.props.x[flower]! + 1.2;
    pool.z[0] = world.props.z[flower]!;
    pool.y[0] = field.habitat.surface(pool.x[0]!, pool.z[0]!) + 0.8;
    pool.cruise[0] = 0.8;
    pool.speed[0] = 0.8;
    pool.homeX[0] = pool.x[0]!;
    pool.homeZ[0] = pool.z[0]!;
    startFlying(pool, 0, context.random);
    pool.timer[0] = 0;
    let sat = false;
    for (let step = 0; step < 30 * 12 && !sat; step += 1) {
      context.time += context.step;
      updateButterfly(pool, 0, context);
      sat = pool.mode[0] === BUTTERFLY_MODE.sit;
    }
    expect(sat).toBe(true);
    const landed = pool.flower[0]!;
    expect(landed).toBeGreaterThanOrEqual(0);
    expect(pool.y[0]).toBeCloseTo(getFlowerTop(world, landed));
    for (let step = 0; step < 30 * 12 && pool.mode[0] === BUTTERFLY_MODE.sit; step += 1) {
      context.time += context.step;
      updateButterfly(pool, 0, context);
    }
    expect(pool.mode[0]).toBe(BUTTERFLY_MODE.fly);
    expect(pool.lastFlower[0]).toBe(landed);
  });
});

describe("butterfly manager", () => {
  const world = createWorld();
  const day = computeEnvironment(world.sun, 12, 0);
  const createView = (zoom: number) => {
    const camera = createCamera(world.start.x, world.start.z, zoom);
    camera.viewportWidth = 1600;
    camera.viewportHeight = 900;
    return camera;
  };

  const run = (seconds: number, zoom: number, environment = day) => {
    const manager = createButterflyManager(world, createHabitatField(world));
    const camera = createView(zoom);
    const region = updateViewRegion(createViewRegion(), camera);
    const field = createField(world);
    let peak = 0;
    let clear = true;
    let frame = manager.update(0, camera, environment);
    for (let time = 0; time < seconds; time += 1 / 60) {
      frame = manager.update(time, camera, environment);
      peak = Math.max(peak, frame.count);
      for (let index = 0; index < frame.count; index += 1) {
        const { x, y, z } = { x: frame.x[index]!, y: frame.y[index]!, z: frame.z[index]! };
        clear &&= y >= field.habitat.surface(x, z) + 0.05 && isInView(region, x, y, z, 3);
      }
    }
    return { clear, frame, manager, peak };
  };

  it("keeps a capped number above the ground in view", () => {
    const { clear, peak } = run(40, 2);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(getButterflyCap(2));
    expect(clear).toBe(true);
    expect(run(30, 1).peak).toBeLessThanOrEqual(8);
  });

  it("is deterministic for the same inputs", () => {
    const first = run(20, 2).frame;
    const second = run(20, 2).frame;
    expect(second.count).toBe(first.count);
    expect([...second.x.subarray(0, second.count)]).toEqual([...first.x.subarray(0, first.count)]);
    expect([...second.wing.subarray(0, second.count)]).toEqual([
      ...first.wing.subarray(0, first.count)
    ]);
  });

  it("shows none zoomed out, at night, in rain or when switched off", () => {
    expect(run(20, 0.5).peak).toBe(0);
    expect(run(20, 2, computeEnvironment(world.sun, 0, 0)).peak).toBe(0);
    expect(run(20, 2, computeEnvironment(world.sun, 12, 0.5)).peak).toBe(0);
    const { manager } = run(20, 2);
    manager.setEnabled(false);
    expect(manager.update(21, createView(2), day).count).toBe(0);
  });
});

describe("flyer atlas", () => {
  const atlas = createFlyerAtlas();
  const alphaAt = (x: number, y: number) => atlas.pixels[(y * atlas.size + x) * 4 + 3]!;
  const cellChecksum = (species: number, variant: number) => {
    const cell = getButterflyCell(species, variant, false);
    let sum = 0;
    for (let row = 0; row < cell.height; row += 1)
      for (let column = 0; column < cell.width; column += 1)
        sum = (sum * 31 + atlas.pixels[((cell.y + row) * atlas.size + cell.x + column) * 4]!) >>> 0;
    return sum;
  };

  it("paints deterministic wing cards: transparent around, opaque wings", () => {
    expect(Buffer.compare(createFlyerAtlas().pixels, atlas.pixels)).toBe(0);
    BUTTERFLY_SPECIES.forEach((_, species) => {
      const cell = getButterflyCell(species, 0, false);
      expect(alphaAt(cell.x + 1, cell.y + 1)).toBe(0);
      let opaque = 0;
      for (let row = 0; row < cell.height; row += 4)
        for (let column = 0; column < cell.width; column += 4)
          if (alphaAt(cell.x + column, cell.y + row) === 255) opaque += 1;
      expect(opaque).toBeGreaterThan(200);
    });
  });

  it("gives every species distinct pattern variants", () => {
    BUTTERFLY_SPECIES.forEach((_, species) => {
      const sums = new Set([0, 1, 2].map((variant) => cellChecksum(species, variant)));
      expect(sums.size).toBe(3);
    });
  });
});
