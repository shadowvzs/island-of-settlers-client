import { expect, it } from "vitest";

import { createDrinkCropMesh } from "../src/render-common/props/drink-crops/drink-crop-meshes";
import { rememberIslandRocks } from "../src/render-common/rocks/island-rock-instances";
import { roadDecorationFieldEnvelope } from "../src/shared/settlement/road-decoration-fields";
import { createRoadDecorationPropClearance } from "../src/shared/settlement/road-decoration-props";
import { FIELD_KINDS } from "../src/shared/settlement/settlement-field-cycles";
import { PROP } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

it("all crop kinds have cached finite mature geometry envelopes, including tall native trees", () => {
  for (const kind of FIELD_KINDS) {
    const bounds = roadDecorationFieldEnvelope(kind);
    expect(bounds.radius, kind).toBeGreaterThan(0); expect(Number.isFinite(bounds.radius)).toBe(true);
    expect(bounds.height).toBeGreaterThan(0); expect(Number.isFinite(bounds.height)).toBe(true);
    expect(roadDecorationFieldEnvelope(kind)).toBe(bounds);
  }
  expect(roadDecorationFieldEnvelope("palm").height).toBeGreaterThan(2.1);
});

it("below-ground authored roots never produce NaN wind attributes in national crop meshes", () => {
  for (const kind of ["tea", "berries", "pomegranate"]) for (const detailed of [true, false]) {
    const mesh = createDrinkCropMesh(`${kind}-ripe`, detailed);
    expect(Array.from(mesh.wind).every(Number.isFinite), `${kind}/${detailed}`).toBe(true);
    expect(Math.min(...mesh.wind)).toBeGreaterThanOrEqual(0);
  }
});

it("actual shrub transforms and remembered rock replacement reject collisions without retaining stale rocks", () => {
  const world = huntingWorld();
  world.props.count = 1; world.props.types[0] = PROP.bush;
  world.props.x[0] = 20; world.props.z[0] = 20; world.props.y[0] = 2; world.props.scale[0] = 1;
  const owner = createRoadDecorationPropClearance(world);
  expect(owner.plantsOverlap(0, { min: [19.9, 2, 19.9], max: [20.1, 3, 20.1] })).toBe(true);
  expect(owner.plantsOverlap(0, { min: [30, 2, 30], max: [31, 3, 31] })).toBe(false);
  const target = { min: [29.9, 2, 29.9], max: [30.1, 3, 30.1] } as const;
  rememberIslandRocks(world, [{ axes: [[1, 0, 0], [0, 2, 0], [0, 0, 1]], centre: [30, 2.5, 30],
    exposure: 0, family: 0, high: true, moss: 0, role: 4, slab: 0, tint: 0, variant: 0 }]);
  expect(owner.rocksOverlap({ min: [...target.min], max: [...target.max] })).toBe(true);
  rememberIslandRocks(world, []);
  expect(owner.rocksOverlap({ min: [...target.min], max: [...target.max] })).toBe(false);
});
