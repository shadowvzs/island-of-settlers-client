import { describe, expect, it } from "vitest";

import { PROP_MESH_SEED } from "../src/render-common/props/prop-mesh-seed";
import { COVER, createPropMesh, getVariantCount } from "../src/render-common/props/prop-meshes";
import { applyGroundTilt, getContactPoints, getRestHeight, placeContactPoint } from "../src/render-common/props/shore-rest";
import { createRandom } from "../src/shared/world/rng";

const SHORE_KINDS = [COVER.openShell, COVER.seashell, COVER.seaStar, COVER.seaSnailShell, COVER.snailShell];

/** A sloped, gently rolling beach surface. */
const createSurface = (slopeX: number, slopeZ: number) => (x: number, z: number) =>
  slopeX * x + slopeZ * z + Math.sin(x * 3.1) * 0.01 + Math.cos(z * 2.7) * 0.01;

describe("shore shells rest on the sand", () => {
  it("turns the up axis to the ground normal", () => {
    const [x, y, z] = applyGroundTilt(0.3, -0.2, [0, 1, 0]);
    expect(x).toBeCloseTo(0.3);
    expect(z).toBeCloseTo(-0.2);
    expect(y).toBeCloseTo(Math.sqrt(1 - 0.09 - 0.04));
  });

  it("puts the lowest mesh point of every kind within 0.01 above the surface", () => {
    const random = createRandom(7);
    for (const kind of SHORE_KINDS) {
      for (let variant = 0; variant < getVariantCount(kind); variant += 1) {
        const mesh = createPropMesh(PROP_MESH_SEED, kind, variant);
        const points = getContactPoints(mesh.positions, mesh.height);
        for (let trial = 0; trial < 6; trial += 1) {
          const slopeX = (random() - 0.5) * 0.6, slopeZ = (random() - 0.5) * 0.6;
          const length = Math.hypot(slopeX, 1, slopeZ);
          const pose = { rotation: random() * Math.PI * 2, scale: 0.85 + random() * 0.3,
            tilt: [-slopeX / length, -slopeZ / length] as const };
          const surface = createSurface(slopeX, slopeZ);
          const at = { x: random() * 10, z: random() * 10 };
          const y = getRestHeight(points, pose, at, surface);
          let gap = Infinity;
          for (let index = 0; index < mesh.positions.length; index += 3) {
            const [dx, dy, dz] = placeContactPoint(
              [mesh.positions[index]!, mesh.positions[index + 1]!, mesh.positions[index + 2]!], pose);
            gap = Math.min(gap, y + dy - surface(at.x + dx, at.z + dz));
          }
          expect(gap, `${kind}/${variant}`).toBeGreaterThanOrEqual(-1e-6);
          expect(gap, `${kind}/${variant}`).toBeLessThanOrEqual(0.01);
        }
      }
    }
  });

  it("lays single valves convex up on their rim and raises the upper valve of open shells", () => {
    for (let variant = 0; variant < getVariantCount(COVER.seashell); variant += 1) {
      const { positions, radius } = createPropMesh(PROP_MESH_SEED, COVER.seashell, variant);
      let rim = 0, touching = 0;
      for (let index = 0; index < positions.length; index += 3) {
        if (Math.hypot(positions[index]!, positions[index + 2]!) < radius * 0.85) continue;
        rim += 1;
        if (positions[index + 1]! < 0.015) touching += 1;
      }
      expect(touching / rim, `seashell/${variant}`).toBeGreaterThan(0.5);
    }
    for (let variant = 0; variant < getVariantCount(COVER.openShell); variant += 1) {
      const { height, radius } = createPropMesh(PROP_MESH_SEED, COVER.openShell, variant);
      expect(height, `openShell/${variant}`).toBeGreaterThan(radius * 0.4);
    }
  });
});
