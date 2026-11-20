import { Frustum, Matrix4, OrthographicCamera } from "three";
import { describe, expect, it } from "vitest";

import {
  createChunkVisibility,
  createDistanceVisibility
} from "../src/renderers/three/three-visibility";

describe("distance visibility", () => {
  it("culls far chunks and keeps boundary chunks stable with hysteresis", () => {
    const visibility = createDistanceVisibility(64, 64, 24, 4);
    expect(visibility.update({ x: 8, z: 8 })).toBe(true);
    expect(visibility.mask[0]).toBe(1);
    expect(visibility.mask[15]).toBe(0);
    const before = [...visibility.mask];
    expect(visibility.update({ x: 8, z: 8 })).toBe(false);
    expect(Array.from(visibility.mask)).toEqual(before);
    visibility.update({ x: 32, z: 32 });
    expect(visibility.mask[0]).toBe(0);
    expect(visibility.mask[5]).toBe(1);
  });

  it("includes tall off-view crowns in a shadow-only frustum", () => {
    const camera = new OrthographicCamera(-5, 5, 5, -5, 1, 11);
    camera.position.set(16, 30, 16);
    camera.rotation.x = -Math.PI / 2;
    camera.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    const ordinary = createChunkVisibility(64, 64);
    const shadowCaster = createChunkVisibility(64, 64, { maxY: 26 });
    ordinary.updateFrustum(frustum);
    shadowCaster.updateFrustum(frustum);
    expect(ordinary.visible[0]).toBe(0);
    expect(shadowCaster.visible[0]).toBe(1);
  });
});
