import { describe, expect, it } from "vitest";

import { createWhaleDirector } from "../src/render-common/whales/whale-director";
import {
  getEventDuration,
  getEventTrack,
  getEventTravel,
  sampleEventTrack,
  WHALE_EVENTS
} from "../src/render-common/whales/whale-events";
import { buildWhaleMesh, WHALE_DETAIL, WHALE_PART } from "../src/render-common/whales/whale-model";
import { bendSpine, createWhalePose, toWorld, updateWhaleBasis } from "../src/render-common/whales/whale-pose";
import type { WhaleView } from "../src/render-common/whales/whale-site";
import { WHALE_SHAPES, WHALE_SPECIES } from "../src/render-common/whales/whale-species";
import { SPRAY_KIND } from "../src/render-common/whales/whale-spray";
import type { WorldData } from "../src/shared/world/world-data";

const SIZE = 96;

/** A square sea `depth` deep everywhere, fully visible. */
const createSea = (depth: number) => {
  const vertices = (SIZE + 1) * (SIZE + 1);
  return {
    cellsX: SIZE,
    cellsZ: SIZE,
    seaLevel: 0,
    seed: 7,
    waterDepth: new Float32Array(vertices).fill(depth),
    waterSurface: new Float32Array(vertices)
  } as unknown as WorldData;
};

/** A view that always looks at the sea point (x, z). */
const createView = (x: number, z: number, sees = true): WhaleView => ({
  castToPlane: (_viewX, _viewY, _height, out) => {
    out.x = x;
    out.z = z;
    return sees;
  },
  eyeX: x - 40,
  eyeZ: z,
  forwardX: 1,
  forwardZ: 0,
  inView: () => sees,
  limitDistance: true
});

const run = (
  director: ReturnType<typeof createWhaleDirector>,
  view: WhaleView,
  from: number,
  seconds: number,
  onFrame?: (frame: ReturnType<typeof director.update>) => void
) => {
  for (let time = from; time <= from + seconds; time += 1 / 30) {
    const frame = director.update(time, view, 0.4, 0.1);
    onFrame?.(frame);
  }
  return from + seconds;
};

describe("whale models", () => {
  it("builds both species at both detail levels within their triangle budgets", () => {
    for (const species of [WHALE_SPECIES.humpback, WHALE_SPECIES.orca]) {
      const full = buildWhaleMesh(species, WHALE_DETAIL.full);
      const lite = buildWhaleMesh(species, WHALE_DETAIL.lite);
      expect(full.indices.length / 3).toBeLessThan(10_500);
      expect(lite.indices.length / 3).toBeLessThan(1500);
      for (const mesh of [full, lite]) {
        const vertices = mesh.positions.length / 3;
        expect(Math.max(...mesh.indices)).toBeLessThan(vertices);
        expect(mesh.normals.every(Number.isFinite)).toBe(true);
        const parts = new Set(Array.from({ length: vertices }, (_, vertex) => Math.floor(mesh.skin[vertex * 3]!)));
        const byNumber = (a: number, b: number) => a - b;
        expect([...parts].sort(byNumber)).toEqual(Object.values(WHALE_PART).sort(byNumber));
      }
    }
  });

  it("keeps the rest body straight and places the nose one half length ahead", () => {
    const pose = createWhalePose();
    updateWhaleBasis(pose);
    const bend = bendSpine(pose, 0.9, { lift: 1, slope: 1 });
    expect(bend.lift).toBeCloseTo(0);
    expect(bend.slope).toBeCloseTo(0);
    const nose = toWorld(pose, [0.5, 0, 0], { x: 0, y: 0, z: 0 });
    expect(nose.x).toBeCloseTo(WHALE_SHAPES[0]!.length / 2);
    expect(nose.y).toBeCloseTo(0);
  });
});

describe("whale events", () => {
  it("passes through every authored key without overshooting held poses", () => {
    const channels = {} as Parameters<typeof sampleEventTrack>[2];
    for (const kind of WHALE_EVENTS) {
      const track = getEventTrack(kind);
      for (const key of track.keys) {
        sampleEventTrack(track, key[0], channels);
        expect(channels.travel).toBeCloseTo(key[1]);
        expect(channels.depth).toBeCloseTo(key[2]);
      }
      for (let index = 1; index < track.keys.length; index += 1) {
        const [from, to] = [track.keys[index - 1]!, track.keys[index]!];
        sampleEventTrack(track, (from[0] + to[0]) / 2, channels);
        expect(channels.depth).toBeGreaterThanOrEqual(Math.min(from[2], to[2]) - 1e-6);
        expect(channels.depth).toBeLessThanOrEqual(Math.max(from[2], to[2]) + 1e-6);
      }
    }
  });
});

describe("whale director", () => {
  it("surfaces only after its interval, in deep visible water in view, then goes idle", () => {
    const director = createWhaleDirector(createSea(5), { rings: 16, spray: 320 });
    const view = createView(48, 48);
    let time = run(director, view, 0, 60);
    expect(director.frame.active).toBe(false);
    director.debug.scheduleIn(0);
    let sprayed = 0;
    let started = false;
    time = run(director, view, time, 25, (frame) => {
      started ||= frame.active;
      sprayed = Math.max(sprayed, frame.spray.count);
    });
    expect(started).toBe(true);
    expect(director.frame.active).toBe(false);
    expect(sprayed).toBeGreaterThan(0);
    run(director, view, time, 30);
    expect(director.frame.spray.count).toBe(0);
    expect(director.frame.ripples.count).toBe(0);
  });

  it("never surfaces in shallow water or off screen", () => {
    for (const [depth, sees] of [[1.5, true], [5, false]] as const) {
      const director = createWhaleDirector(createSea(depth), { rings: 16, spray: 320 });
      director.debug.scheduleIn(0);
      run(director, createView(48, 48, sees), 0, 60, (frame) => expect(frame.active).toBe(false));
    }
  });

  it("throws splash spray when a breaching whale falls back", () => {
    const director = createWhaleDirector(createSea(5), { rings: 16, spray: 320 });
    const view = createView(48, 48);
    run(director, view, 0, 0.1);
    director.debug.trigger("breach", WHALE_SPECIES.humpback, { x: 45, yaw: 0, z: 48 });
    let droplets = 0;
    run(director, view, 0.1, getEventDuration("breach", WHALE_SPECIES.humpback), (frame) => {
      for (let index = 0; index < frame.spray.count; index += 1)
        if (frame.spray.look[index * 4 + 1] === SPRAY_KIND.spray) droplets += 1;
    });
    expect(droplets).toBeGreaterThan(0);
  });

  it("keeps every event within its shortened travel (the whole path stays where the site was found)", () => {
    for (const kind of WHALE_EVENTS) {
      const director = createWhaleDirector(createSea(5), { rings: 16, spray: 120 });
      const view = createView(48, 48);
      run(director, view, 0, 0.1);
      director.debug.trigger(kind, WHALE_SPECIES.humpback, { x: 40, yaw: 0, z: 48 });
      const limit = getEventTravel(kind) * WHALE_SHAPES[0]!.length + 1e-3;
      run(director, view, 0.1, getEventDuration(kind, WHALE_SPECIES.humpback) - 0.2, (frame) => {
        if (frame.active) expect(Math.hypot(frame.pose.x - 40, frame.pose.z - 48)).toBeLessThanOrEqual(limit);
      });
      expect(getEventTravel(kind)).toBeLessThan(1);
    }
  });

  it("ends a running event and drops its water when switched off", () => {
    const director = createWhaleDirector(createSea(5), { rings: 16, spray: 120 });
    const view = createView(48, 48);
    run(director, view, 0, 0.1);
    director.debug.trigger("blow", WHALE_SPECIES.orca, { x: 45, yaw: 0, z: 48 });
    run(director, view, 0.1, 3);
    expect(director.frame.active).toBe(true);
    director.setEnabled(false);
    const frame = director.update(3.2, view, 0, 0);
    expect(frame.active).toBe(false);
    expect(frame.spray.count).toBe(0);
    director.debug.scheduleIn(0);
    run(director, view, 3.3, 10, (next) => expect(next.active).toBe(false));
  });
});
