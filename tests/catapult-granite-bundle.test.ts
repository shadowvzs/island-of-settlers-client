import { describe, expect, it } from "vitest";

import { createCatapultGraniteBundle } from "../src/renderers/three/buildings/catapult-granite-bundle";

describe("granite bundle presentation (CAT-5)", () => {
  it("builds merged stones and rope (two draw calls) in both LODs", () => {
    for (const detailed of [true, false]) {
      const bundle = createCatapultGraniteBundle(detailed, .2);
      expect(bundle.children).toHaveLength(2); // merged stones + merged rope
      expect(bundle.userData.catapultBundle).toBe(true);
      expect(typeof bundle.userData.disposeOwnedMaterials).toBe("function");
      bundle.userData.disposeOwnedMaterials();
    }
  });

  it("keeps the bundle inside a compact carried envelope", () => {
    const bundle = createCatapultGraniteBundle(false, .2);
    expect(Math.abs(bundle.position.y)).toBeLessThan(.2);
    bundle.userData.disposeOwnedMaterials();
  });
});

describe("roof bundle overlay (CAT-5)", () => {
  it("swaps the solid stone for the granite bundle or the marble sphere, other kinds stay solid", async () => {
    const { BoxGeometry, Group, Mesh, MeshBasicMaterial } = await import("three");
    const { attachCatapultRoofBundles, presentCatapultShot } =
      await import("../src/renderers/three/buildings/catapult-roof-bundles");
    const root = new Group(), stone = new Mesh(new BoxGeometry(.2, .2, .2), new MeshBasicMaterial());
    stone.userData.catapultRockMaterial = true; stone.userData.catapultPart = "loaded";
    root.add(stone);
    const dispose = attachCatapultRoofBundles(root, false);
    const solid = stone.geometry, [bundle, marble] = stone.children;
    presentCatapultShot(stone, "granite");
    expect([bundle!.visible, marble!.visible]).toEqual([true, false]);
    expect(stone.geometry).not.toBe(solid);
    presentCatapultShot(stone, "marble");
    expect([bundle!.visible, marble!.visible]).toEqual([false, true]);
    expect(stone.geometry).not.toBe(solid);
    expect(marble!.scale.x).toBeCloseTo(.2, 6);
    presentCatapultShot(stone, "basalt");
    expect([bundle!.visible, marble!.visible]).toEqual([false, false]);
    expect(stone.geometry).toBe(solid);
    dispose();
  });
});

describe("runtime stone props outside the static building budget", () => {
  /** Own caps per presented shot (one bundle or one marble sphere replaces one solid stone). */
  const SHOT_CAPS = { high: 1800, minimal: 700 } as const;
  const meshTriangles = (object: import("three").Object3D) => {
    let count = 0;
    object.traverse(child => {
      const mesh = child as import("three").Mesh;
      if (mesh.isMesh) count += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
    });
    return count;
  };

  it.each([true, false])("flags overlays as runtime props within their own cap, detail=%s", async detailed => {
    const { BoxGeometry, Group, Mesh, MeshBasicMaterial } = await import("three");
    const { attachCatapultRoofBundles } = await import("../src/renderers/three/buildings/catapult-roof-bundles");
    const { isDynamicBuildingGeometry } = await import("../src/renderers/three/buildings/building-runtime-props");
    const root = new Group(), stone = new Mesh(new BoxGeometry(.2, .2, .2), new MeshBasicMaterial());
    stone.userData.catapultRockMaterial = true; stone.userData.catapultPart = "loaded";
    root.add(stone);
    const dispose = attachCatapultRoofBundles(root, detailed), [bundle, marble] = stone.children;
    expect(isDynamicBuildingGeometry(stone)).toBe(false);
    for (const overlay of [bundle!, marble!]) {
      overlay.traverse(child => expect(isDynamicBuildingGeometry(child)).toBe(true));
      expect(meshTriangles(overlay)).toBeLessThanOrEqual(SHOT_CAPS[detailed ? "high" : "minimal"]);
    }
    dispose();
  });

  it("shares one kit between towers of the same detail level", async () => {
    const { BoxGeometry, Group, Mesh, MeshBasicMaterial } = await import("three");
    const { attachCatapultRoofBundles } = await import("../src/renderers/three/buildings/catapult-roof-bundles");
    const towers = [0, 1].map(() => {
      const root = new Group(), stone = new Mesh(new BoxGeometry(.2, .2, .2), new MeshBasicMaterial());
      stone.userData.catapultRockMaterial = true; stone.userData.catapultPart = "loaded";
      root.add(stone);
      const dispose = attachCatapultRoofBundles(root, false);
      return { dispose, marble: stone.children[1] as InstanceType<typeof Mesh> };
    });
    expect(towers[0]!.marble.geometry).toBe(towers[1]!.marble.geometry);
    towers.forEach(tower => tower.dispose());
  });
});
