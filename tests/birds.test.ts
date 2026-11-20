import { describe, expect, it } from "vitest";

import {
  FEATHER_MEAN,
  getWingFeatherShade,
  PAINTED_PRIMARIES
} from "../src/render-common/birds/bird-feathers";
import {
  getBankAngle,
  getLandingProfile,
  getMeanderHeading,
  getSteerTurn,
  getTakeoffProfile,
  getWingPose,
  getWingTuck,
  lerpAngle,
  steerHeading,
  wrapAngle
} from "../src/render-common/birds/bird-flight";
import {
  createHabitatField,
  getCoverPerchHeight,
  sampleHabitat
} from "../src/render-common/birds/bird-habitat";
import {
  BIRD_CAPACITY,
  createBirdManager,
  getBirdActivity,
  getDesiredFlocks
} from "../src/render-common/birds/bird-manager";
import {
  createBirdGeometry,
  deformBirdNormal,
  deformBirdPoint
} from "../src/render-common/birds/bird-mesh";
import { pickEntryOutOfView, pickSpawn } from "../src/render-common/birds/bird-spawner";
import { BIRD_SPECIES } from "../src/render-common/birds/bird-species";
import {
  createViewRegion,
  isInView,
  pickEdgeEntry,
  updateViewRegion
} from "../src/render-common/birds/bird-view";
import { createCamera } from "../src/render-common/camera-state";
import { computeEnvironment } from "../src/render-common/environment";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createRandom } from "../src/shared/world/rng";
import { FOG } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const pose = { angle: 0, fold: 0 };

describe("bird flight helpers", () => {
  it("wraps and interpolates angles the short way round", () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
  });

  it("turns towards the desired heading no faster than the turn rate", () => {
    const next = steerHeading(0, Math.PI, 1.5, 0.1);
    expect(Math.abs(next)).toBeCloseTo(0.15);
    expect(steerHeading(0, 0.01, 1.5, 0.1)).toBeCloseTo(0.01);
  });

  it("meanders around the course and steers there within the turn rate", () => {
    for (const noise of [-1, -0.3, 0, 0.4, 1]) {
      const desired = getMeanderHeading(1, noise, -noise);
      expect(Math.abs(wrapAngle(desired - 1))).toBeLessThanOrEqual(1);
      expect(Math.abs(getSteerTurn(0, desired, 0.8))).toBeLessThanOrEqual(0.8);
    }
    expect(getSteerTurn(0, 0.3, 2)).toBeGreaterThan(0);
    expect(getSteerTurn(0, -0.3, 2)).toBeLessThan(0);
  });

  it("banks into turns, capped", () => {
    expect(getBankAngle(1, 3)).toBeGreaterThan(0);
    expect(getBankAngle(-1, 3)).toBeLessThan(0);
    expect(Math.abs(getBankAngle(50, 5))).toBeLessThanOrEqual(0.85);
  });

  it("glides at the dihedral and folds the wings on the up stroke", () => {
    const species = { flapAmplitude: 0.8, glideDihedral: 0.1, glideFold: 0.5 };
    expect(getWingPose(0, 0, 0, species, pose).angle).toBeCloseTo(0.1);
    expect(pose.fold).toBeCloseTo(0.5);
    getWingPose(0, 1, 0, species, pose);
    expect(pose.fold).toBeGreaterThan(0);
    getWingPose(Math.PI, 1, 0, species, pose);
    expect(pose.fold).toBe(0);
    const level = { ...species, glideDihedral: 0, glideFold: 0 };
    expect(getWingPose(Math.PI / 2, 1, 0, level, pose).angle).toBeCloseTo(0.8);
  });

  it("holds the glide wings nearly still (a slight flex only)", () => {
    const species = BIRD_SPECIES[3]!;
    for (let phase = 0; phase < Math.PI * 2; phase += 0.4) {
      const angle = getWingPose(phase, 0, 0, species, pose).angle;
      expect(Math.abs(angle - species.glideDihedral)).toBeLessThan(0.04);
    }
  });

  it("tucks the wings in tight turns and when landing", () => {
    expect(getWingTuck(0, -1)).toBe(0);
    expect(getWingTuck(0.8, -1)).toBeGreaterThan(0.5);
    expect(getWingTuck(0, 1)).toBe(1);
    const species = BIRD_SPECIES[2]!;
    const open = getWingPose(1, 0, 0, species, { angle: 0, fold: 0 });
    const tucked = getWingPose(1, 0, 0.8, species, { angle: 0, fold: 0 });
    expect(tucked.fold).toBeGreaterThan(open.fold + 0.4);
  });

  it("takes off slow with strong beats and lands slow at the perch height", () => {
    const start = getTakeoffProfile(0);
    const end = getTakeoffProfile(1);
    expect(start.speed).toBeLessThan(end.speed);
    expect(start.flapBoost).toBeGreaterThan(end.flapBoost);
    expect(getLandingProfile(0, 10)).toMatchObject({ glide: true, height: 0, speed: 0.55 });
    expect(getLandingProfile(10, 10).height).toBe(1);
  });
});

describe("bird mesh", () => {
  it("bends the wings only, tips more than the arm, and folds them in", () => {
    const geometry = createBirdGeometry(BIRD_SPECIES[0]!.shape);
    const out = new Float32Array(3);
    deformBirdPoint(0.2, 0, 0, 0, { angle: 0.8, fold: 0 }, out, 0);
    expect(out).toEqual(Float32Array.from([0.2, 0, 0]));
    deformBirdPoint(0, 0, 0.5, 1, { angle: 0.5, fold: 0 }, out, 0);
    const tipLift = out[1]!;
    expect(tipLift).toBeGreaterThan(0.5 * Math.sin(0.5));
    deformBirdPoint(0, 0, 0.5, 1, { angle: 0, fold: 1 }, out, 0);
    expect(out[2]!).toBeLessThan(0.5);
    expect(geometry.positions.length).toBe(geometry.spans.length * 3);
  });

  it("builds valid meshes: indices in range, unit normals, feather UVs in the atlas", () => {
    for (const species of BIRD_SPECIES) {
      const geometry = createBirdGeometry(species.shape);
      const vertices = geometry.spans.length;
      expect(geometry.indices.length % 3).toBe(0);
      expect(Math.max(...geometry.indices)).toBeLessThan(vertices);
      for (let vertex = 0; vertex < vertices; vertex += 1) {
        const n = geometry.normals.subarray(vertex * 3, vertex * 3 + 3);
        expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 3);
        const u = geometry.uvs[vertex * 2]!;
        expect(u === -1 || (u >= 0 && u <= 1)).toBe(true);
      }
      expect(geometry.indices.length / 3).toBeLessThan(200);
      expect(PAINTED_PRIMARIES % species.shape.primaries).toBe(0);
    }
  });

  it("gives every species its own silhouette (span chord, tail fork, finger notches)", () => {
    const silhouettes = BIRD_SPECIES.map(({ shape }) =>
      [shape.tailFork, shape.primaryNotch, shape.wing.at(-2)!.span].join()
    );
    expect(new Set(silhouettes).size).toBe(BIRD_SPECIES.length);
  });

  it("turns wing normals with the wing beat", () => {
    const out = new Float32Array(3);
    deformBirdNormal([0, 1, 0], 1, 0.4, { angle: 0.6, fold: 0 }, out, 0);
    const point = new Float32Array(3);
    deformBirdPoint(0, 0, 0.4, 1, { angle: 0.6, fold: 0 }, point, 0);
    // The bent point lies in the x = 0 plane, so only the y and z terms of the dot product remain.
    expect(out[1]! * point[1]! + out[2]! * point[2]!).toBeCloseTo(0, 5);
  });
});

describe("bird feathers", () => {
  it("averages the feather detail to FEATHER_MEAN", () => {
    let sum = 0;
    let count = 0;
    for (let u = 0.01; u < 1; u += 0.02) {
      for (let v = 0.01; v < 1; v += 0.02) {
        sum += getWingFeatherShade(u, v);
        count += 1;
      }
    }
    expect(Math.abs(sum / count - FEATHER_MEAN)).toBeLessThan(0.03);
  });
});

describe("bird view region", () => {
  const camera = createCamera(50, 50, 1);
  camera.viewportWidth = 1600;
  camera.viewportHeight = 900;
  const region = updateViewRegion(createViewRegion(), camera);

  it("contains the centre and not far away points", () => {
    expect(isInView(region, 50, 0, 50, 0)).toBe(true);
    expect(isInView(region, 120, 0, 120, 0)).toBe(false);
  });

  it("lets birds fly in from just outside an edge, heading inwards", () => {
    const random = createRandom(3);
    for (let index = 0; index < 20; index += 1) {
      const entry = pickEdgeEntry(region, random, 2);
      expect(isInView(region, entry.x, 0, entry.z, 0)).toBe(false);
      const toCentre = Math.atan2(50 - entry.z, 50 - entry.x);
      expect(Math.abs(wrapAngle(toCentre - entry.heading))).toBeLessThan(Math.PI / 2);
    }
  });
});

describe("bird spawning", () => {
  const sun = { azimuthX: 0.6, azimuthZ: -0.8, elevation: 0.8 };

  it("is quiet at night and stops in heavy rain", () => {
    const day = getBirdActivity(computeEnvironment(sun, 12, 0));
    const night = getBirdActivity(computeEnvironment(sun, 0, 0));
    expect(day).toBeCloseTo(1);
    expect(night).toBeLessThan(0.2);
    expect(getBirdActivity(computeEnvironment(sun, 12, 1))).toBe(0);
    expect(getDesiredFlocks(1400, night)).toBeLessThan(getDesiredFlocks(1400, day));
    expect(getDesiredFlocks(1400, 0)).toBe(0);
    expect(getDesiredFlocks(1400, day, 1)).toBe(Math.round(getDesiredFlocks(1400, day) / 2));
    expect(getDesiredFlocks(1400, day, 0)).toBe(getDesiredFlocks(1400, day));
  });
});

describe("bird manager", () => {
  const world = cachedWorld({
    ...DEFAULT_WORLD_OPTIONS,
    cellsX: 64,
    cellsZ: 64,
    erosionDroplets: 4000
  });
  world.fog.fill(FOG.visible);
  const day = computeEnvironment(world.sun, 12, 0);

  const run = (seconds: number) => {
    const manager = createBirdManager(world);
    const camera = createCamera(world.start.x, world.start.z, 0.7);
    camera.viewportWidth = 1600;
    camera.viewportHeight = 900;
    let counts = 0;
    let frame = manager.update(0, camera, day);
    for (let time = 0; time < seconds; time += 1 / 60) {
      frame = manager.update(time, camera, day);
      counts = Math.max(counts, frame.count);
    }
    return { camera, frame, manager, peak: counts };
  };

  it("fills the view with a bounded number of birds", () => {
    const { peak } = run(40);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(BIRD_CAPACITY);
  });

  it("is deterministic for the same inputs", () => {
    const first = run(20).frame;
    const second = run(20).frame;
    expect(second.count).toBe(first.count);
    expect([...second.x.subarray(0, second.count)]).toEqual([...first.x.subarray(0, first.count)]);
  });

  it("keeps birds near the view and clears them when switched off", () => {
    const { camera, frame, manager } = run(30);
    for (let bird = 0; bird < frame.count; bird += 1) {
      const distance = Math.hypot(frame.x[bird]! - camera.centerX, frame.z[bird]! - camera.centerZ);
      expect(distance).toBeLessThan(80);
    }
    manager.scare(camera.centerX, camera.centerZ, 10);
    manager.setEnabled(false);
    expect(manager.update(31, camera, day).count).toBe(0);
  });
});

describe("birds flying in", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96 });
  const field = createHabitatField(world);

  it("start outside the view at their flight height, never popping in on screen", () => {
    expect.hasAssertions();
    const region = createViewRegion();
    const camera = { ...createCamera(48, 48, 1), viewportHeight: 900, viewportWidth: 1600 };
    updateViewRegion(region, camera);
    const random = createRandom(7);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const entry = pickEntryOutOfView(field, region, random, 6);
      if (entry) expect(isInView(region, entry.x, entry.y, entry.z, 0)).toBe(false);
    }
  });
});

describe("birds taking off", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96 });
  world.fog.fill(FOG.visible);
  const field = createHabitatField(world);

  it("rise only from cover (leafy crowns, big bushes), never from bare ground", () => {
    const region = createViewRegion();
    const camera = { ...createCamera(48, 48, 1), viewportHeight: 900, viewportWidth: 1600 };
    updateViewRegion(region, camera);
    const random = createRandom(11);
    let perched = 0;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const spawn = pickSpawn(field, region, random);
      if (!spawn?.fromPerch) continue;
      perched += 1;
      expect(sampleHabitat(field, field.cover, spawn.x, spawn.z)).toBeGreaterThan(0.45);
      expect(spawn.y).toBeGreaterThan(field.surface(spawn.x, spawn.z) + 0.2);
    }
    expect(perched).toBeGreaterThan(0);
  });

  it("finds no takeoff perch where there is no cover (open grass, palms)", () => {
    const bare = createHabitatField(world);
    bare.cover.fill(0);
    const species = BIRD_SPECIES.find((candidate) => candidate.perches === "both")!;
    expect(getCoverPerchHeight(bare, species, 48, 48)).toBeNull();
  });
});
