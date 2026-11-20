import {
  BufferGeometry, Group, OrthographicCamera, PerspectiveCamera, SkinnedMesh, Vector3
} from "three";
import { describe, expect, it } from "vitest";

import { advanceMountGuard } from "../src/render-common/mounts/mount-engage";
import {
  createMountDetail, NEAR_PIXELS_PER_CELL, pairFarGeometry, pixelsPerUnit
} from "../src/renderers/three/mount-detail";

const model = (...names: string[]) => {
  const root = new Group();
  for (const name of names) root.add(Object.assign(new SkinnedMesh(new BufferGeometry()), { name }));
  return root;
};

describe("mounted soldier distance detail", () => {
  it("measures screen pixels per map cell with either camera", () => {
    const perspective = new PerspectiveCamera(30, 1, .1, 100);
    perspective.position.set(0, 0, 10); perspective.lookAt(0, 0, 0); perspective.updateMatrixWorld();
    const expected = 800 / (2 * 10 * Math.tan(15 * Math.PI / 180));
    expect(pixelsPerUnit(perspective, new Vector3(), 800)).toBeCloseTo(expected, 1);
    expect(pixelsPerUnit(perspective, new Vector3(0, 0, -10), 800)).toBeCloseTo(expected / 2, 1);
    const ortho = new OrthographicCamera(-5, 5, 5, -5, .1, 100);
    ortho.position.set(0, 0, 10); ortho.updateMatrixWorld();
    expect(pixelsPerUnit(ortho, new Vector3(0, 0, -30), 800)).toBeCloseTo(80, 3);
  });

  it("pairs the body meshes (not the armour) of the full and the simplified model", () => {
    const near = model("body", "armour_torso_lod0"), far = model("body");
    const pairs = pairFarGeometry(near, far);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.far).toBe((far.children[0] as SkinnedMesh).geometry);
    expect(pairFarGeometry(near, model("body", "body_1"))).toHaveLength(0);
  });

  it("swaps geometry and armour LOD past the switch size, with hysteresis", () => {
    const root = model("body", "armour_torso_lod0", "armour_torso_lod1");
    const [body, lod0, lod1] = root.children as SkinnedMesh[];
    const nearGeometry = body!.geometry;
    const [pair] = pairFarGeometry(root, model("body"));
    const detail = createMountDetail(root, [pair!]);
    detail.update(NEAR_PIXELS_PER_CELL * .97);
    expect(detail.isNear()).toBe(true);
    detail.update(NEAR_PIXELS_PER_CELL * .9);
    expect(detail.isNear()).toBe(false);
    expect(body!.geometry).toBe(pair!.far);
    expect([lod0!.visible, lod1!.visible]).toEqual([false, true]);
    detail.update(NEAR_PIXELS_PER_CELL * 1.03);
    expect(detail.isNear()).toBe(false);
    detail.update(NEAR_PIXELS_PER_CELL * 1.1);
    expect(body!.geometry).toBe(nearGeometry);
    expect([lod0!.visible, lod1!.visible]).toEqual([true, false]);
  });

  it("casts the sun shadow with the far geometry only while near, then restores it", () => {
    const root = model("body");
    const [body] = root.children as SkinnedMesh[];
    const nearGeometry = body!.geometry;
    const [pair] = pairFarGeometry(root, model("body"));
    const detail = createMountDetail(root, [pair!]);
    detail.useCasterGeometry(true);
    expect(body!.geometry).toBe(pair!.far);
    detail.useCasterGeometry(false);
    expect(body!.geometry).toBe(nearGeometry);
    detail.update(NEAR_PIXELS_PER_CELL * .5);
    detail.useCasterGeometry(true);
    detail.useCasterGeometry(false);
    expect(body!.geometry).toBe(pair!.far);
  });

  it("raises a rider's parry while it is threatened and lowers it afterwards", () => {
    let guard = 0;
    for (let step = 0; step < 6; step++) guard = advanceMountGuard(guard, true, .05);
    expect(guard).toBeGreaterThan(.85);
    for (let step = 0; step < 10; step++) guard = advanceMountGuard(guard, false, .05);
    expect(guard).toBeLessThan(.02);
  });
});
