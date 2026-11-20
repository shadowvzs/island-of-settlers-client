import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { fitSourceClothBoneRays } from "../tools/analysis/source-cloth-donor-ray-fit";
import { closestClothRayTriangle, solveConnectedClothRays } from "../tools/analysis/source-cloth-ray-triangle";

describe("actual source cloth ray/triangle geometry", () => {
  it("detects a finite interior cover and rejects a triangle beyond the ray interval", () => {
    const points = [new Vector3(-1, -1, 1), new Vector3(1, -1, 1), new Vector3(0, 1, 1)];
    expect(closestClothRayTriangle(new Vector3(), new Vector3(0, 0, 1), 2, points).distanceSquared).toBe(0);
    expect(closestClothRayTriangle(new Vector3(), new Vector3(0, 0, 1), .5, points).distanceSquared).toBeCloseTo(.25, 12);
  });
  it("matches an independent finite difference when the closest barycentric point moves", () => {
    const points = [new Vector3(1, -1, 0), new Vector3(2, -1, 0), new Vector3(1, 1, 0)];
    const origin = new Vector3(), direction = new Vector3(0, 0, 1);
    const result = closestClothRayTriangle(origin, direction, 1, points);
    const derivative = 2 * result.residual.x * result.bary[0]!;
    const delta = 1e-6, plus = points.map(point => point.clone()), minus = points.map(point => point.clone());
    plus[0]!.x += delta; minus[0]!.x -= delta;
    const numeric = (closestClothRayTriangle(origin, direction, 1, plus).distanceSquared
      - closestClothRayTriangle(origin, direction, 1, minus).distanceSquared) / (2 * delta);
    expect(derivative).toBeCloseTo(numeric, 6);
  });
  it("moves a constrained source simplex along exact geometric gradients", () => {
    const result = solveConnectedClothRays([[[1, 0], [0, 1]]], [1, 0], weights => {
      const residual = Math.max(0, weights[0]! - .2);
      return { gradient: [2 * residual, 0], maximumDistance: residual, objective: residual * residual };
    });
    expect(result.targetRaysCovered).toBe(true);
    expect(result.weights[0]! + result.weights[1]!).toBeCloseTo(1, 12);
  });
  it("allows an actual adjacent cloth face to preserve coverage when contact leaves the original face", () => {
    const corners = (points: Vector3[]) => points.map(base => ({ base, delta: new Vector3(), group: -1 }));
    const missed = corners([new Vector3(2, -1, .5), new Vector3(3, -1, .5), new Vector3(2, 1, .5)]);
    const covered = corners([new Vector3(-1, -1, .5), new Vector3(2, -1, .5), new Vector3(-1, 1, .5)]);
    const constraint = { corners: missed, direction: new Vector3(0, 0, 1), length: 1, origin: new Vector3() };
    const hull = [[[1, 0, 0, 0]]], seed = [1, 0, 0, 0];
    expect(fitSourceClothBoneRays(hull, seed, [constraint], 1).targetRaysCovered).toBe(false);
    expect(fitSourceClothBoneRays(hull, seed, [{ ...constraint, alternatives: [covered] }], 1)
      .targetRaysCovered).toBe(true);
    const behind = covered.map(corner => ({ ...corner, base: corner.base.clone().setZ(-.1) }));
    expect(fitSourceClothBoneRays(hull, seed, [{ ...constraint, alternatives: [behind] }], 1)
      .targetRaysCovered).toBe(false);
  });
});
