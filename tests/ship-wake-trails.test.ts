import { describe, expect, it } from "vitest";

import {
  createWakeBuffers,
  createWakeTrails,
  WAKE_LIFE_SECONDS,
  WAKE_ROW_VERTICES,
  WAKE_ROWS,
  type WakeWaterSampler
} from "../src/render-common/ships/ship-wake-trails";

const HULL = { beam: 3.36, length: 8.8 };
const flatSea: WakeWaterSampler = (_x, _z, out) => {
  out.height = 0;
  out.depth = 4;
};

/** Sails one hull north (yaw 0) at `speed` for `seconds`, 30 frames a second. */
const sail = (seconds: number, speed = 2.4, start = 0) => {
  const buffers = createWakeBuffers(2);
  const trails = createWakeTrails(2);
  let indices = 0;
  const frames = Math.round(seconds * 30);
  for (let frame = 0; frame <= frames; frame++) {
    const time = start + frame / 30;
    trails.track(1, HULL, 10, 10 + time * speed, 0, time);
    indices = trails.finish(buffers, flatSea, time);
  }
  return { buffers, indices, time: start + frames / 30, trails };
};

describe("ship wake trails", () => {
  it("starts at the bow and widens along the Kelvin wedge behind the stern", () => {
    const { buffers, indices } = sail(4);
    expect(indices).toBeGreaterThan(6);
    const bowZ = buffers.position[2]!;
    const sternZ = buffers.position[WAKE_ROW_VERTICES * 3 + 2]!;
    expect(bowZ - sternZ).toBeCloseTo(HULL.length, 3);
    const halfWidth = (row: number) => buffers.shape[row * WAKE_ROW_VERTICES * 4]!;
    expect(halfWidth(1)).toBeGreaterThan(halfWidth(0));
    expect(halfWidth(3)).toBeGreaterThan(halfWidth(1));
    const vertices = WAKE_ROWS * WAKE_ROW_VERTICES;
    for (let index = 0; index < indices; index++) expect(buffers.index[index]).toBeLessThan(vertices);
  });

  it("fades out and frees the slot once the hull is gone", () => {
    const { buffers, time, trails } = sail(3);
    let indices = 1;
    for (let frame = 1; frame <= (WAKE_LIFE_SECONDS + 1) * 30; frame++)
      indices = trails.finish(buffers, flatSea, time + frame / 30);
    expect(indices).toBe(0);
  });

  it("leaves no foam on a stationary hull", () => {
    const { buffers, indices } = sail(3, 0);
    const vertices = (indices / 6 + 1) * WAKE_ROW_VERTICES;
    for (let vertex = 0; vertex < vertices; vertex++) expect(buffers.wake[vertex * 4 + 3]).toBe(0);
  });
});
