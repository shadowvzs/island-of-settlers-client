import { describe, expect, it } from "vitest";

import {
  DEATH_FALL_SECONDS, DEATH_SMOKE_DEPTH_BIAS, type DeathSmokePuff,
deathSmokePuff, deathSmokePuffCount,   type DeathSmokeSource
} from "../src/render-common/settlement/death-smoke";
import { MILITARY_DEATH_SECONDS } from "../src/shared/settlement/military-combat-rules";

/** Inside this share of a puff sprite's size its soft disc is still dense smoke. */
const DENSE_SHARE = .36;
const YAW = .7;
/** The iso view (30°), a steeper tilt and a near top-down one, from eight directions. */
const VIEWS = [Math.PI / 6, Math.PI / 3, 1.3].flatMap(pitch => Array.from({ length: 8 }, (_, step) => ({
  x: Math.cos(pitch) * Math.cos(step * Math.PI / 4), y: Math.sin(pitch), z: Math.cos(pitch) * Math.sin(step * Math.PI / 4)
})));
type Point = { x: number; y: number; z: number };

/** World point at `forward` along the heading, `side` to the right and `up` above the death spot. */
const bodyPoint = (forward: number, side: number, up: number): Point => ({
  x: Math.sin(YAW) * forward + Math.cos(YAW) * side, y: up, z: Math.cos(YAW) * forward - Math.sin(YAW) * side
});

const grid = (forward: [number, number], side: [number, number], up: [number, number]) => {
  const points: Point[] = [];
  for (let f = 0; f <= 4; f++) for (let s = 0; s <= 2; s++) for (let u = 0; u <= 4; u++) points.push(bodyPoint(
    forward[0] + (forward[1] - forward[0]) * f / 4, side[0] + (side[1] - side[0]) * s / 2,
    up[0] + (up[1] - up[0]) * u / 4));
  return points;
};

/** A puff hides a point when its biased quad lies in front of it, close to the line of sight. */
const hides = (puff: DeathSmokePuff, point: Point, view: Point) => {
  const dx = puff.x - point.x, dy = puff.y - point.y, dz = puff.z - point.z;
  const along = dx * view.x + dy * view.y + dz * view.z;
  if (along < -DEATH_SMOKE_DEPTH_BIAS * puff.scale) return false;
  return Math.hypot(dx - along * view.x, dy - along * view.y, dz - along * view.z) <= puff.scale * DENSE_SHARE;
};

const visibleParts = (source: DeathSmokeSource, detailed: boolean, points: readonly Point[]) => {
  const count = deathSmokePuffCount(source.mounted ? "cavalry" : "foot", detailed);
  const puffs = Array.from({ length: count }, (_, index) => deathSmokePuff(source, index, detailed));
  return VIEWS.flatMap(view => points.filter(point => !puffs.some(puff => hides(puff, point, view))));
};

describe("death smoke", () => {
  for (const detailed of [true, false]) {
    const level = detailed ? "High" : "Minimal";
    it(`hides a fallen foot soldier, standing and lying, on ${level}`, () => {
      const source = { age: DEATH_FALL_SECONDS, x: 0, y: 0, yaw: YAW, z: 0 };
      expect(visibleParts(source, detailed, grid([-.15, .15], [-.15, .15], [.05, 1.06]))).toEqual([]);
      expect(visibleParts(source, detailed, grid([0, 1.05], [-.2, .2], [.05, .3]))).toEqual([]);
    });
    it(`hides a rider and horse, standing and on their side, on ${level}`, () => {
      const source = { age: DEATH_FALL_SECONDS, mounted: true, x: 0, y: 0, yaw: YAW, z: 0 };
      expect(visibleParts(source, detailed, grid([-.95, .95], [-.25, .25], [.1, 1.7]))).toEqual([]);
      expect(visibleParts(source, detailed, grid([-.95, .95], [0, 1.7], [.05, .4]))).toEqual([]);
    });
    it(`keeps the soft puff edges, not their centres, below the ground on ${level}`, () => {
      for (const mounted of [false, true]) {
        const count = deathSmokePuffCount(mounted ? "cavalry" : "foot", detailed);
        for (let index = 0; index < count; index++) {
          const puff = deathSmokePuff({ age: 0, mounted, x: 0, y: 0, z: 0 }, index, detailed);
          // The ground meets the biased quad below its edge for the 30° iso view.
          expect((puff.y + DEATH_SMOKE_DEPTH_BIAS * puff.scale * Math.sin(Math.PI / 6)) / Math.cos(Math.PI / 6))
            .toBeGreaterThan(puff.scale * .45);
        }
      }
    });
  }
  it("builds up while the body falls and is gone when the effect ends", () => {
    const at = (age: number) => deathSmokePuff({ age, x: 0, y: 0, z: 0 }, 0, true).opacity;
    expect(at(0)).toBe(0);
    expect(at(DEATH_FALL_SECONDS)).toBeGreaterThan(.8);
    expect(at(MILITARY_DEATH_SECONDS)).toBe(0);
  });
});
