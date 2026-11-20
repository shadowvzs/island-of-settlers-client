import { Box3, Euler, Matrix4, Mesh, PerspectiveCamera, Raycaster, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { chineseRoadPailouParts } from "../src/render-common/road-decoration-eastern";
import { createHangingLanternRoadRecipe } from "../src/render-common/road-decoration-hanging-lanterns";
import { japaneseRoadToriiParts } from "../src/render-common/road-decoration-japanese";
import { ornamentalDecorationProfile } from "../src/renderers/three/plants/ornamental-decoration-profile";
import { createHangingLanternRoadModel } from "../src/renderers/three/road-decoration-hanging-lanterns";
import { ROAD_DECORATIONS } from "../src/shared/settlement/road-decoration-catalog";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("bounds actual hanging portal geometry by both selector tier costs and frames the full native near view", () => {
  const materials = createPlainBuildingMaterials();
  const camera = new PerspectiveCamera(35, 1100 / 900, .02, 1000);
  camera.position.set(10, 1.65 + 12 * .12, 22); camera.lookAt(10, 1.65, 10); camera.updateMatrixWorld();
  const world = new Matrix4().makeRotationY(Math.PI / 4).setPosition(10, 0, 10);
  try {
    for (const nation of ["japanese", "chinese"] as const) for (const detailed of [true, false]) {
      const model = createHangingLanternRoadModel(nation, detailed, materials);
      try {
        let triangles = 0;
        model.root.traverse(node => {
          if (!(node instanceof Mesh)) return;
          const positions = node.geometry.getAttribute("position");
          triangles += (node.geometry.index?.count ?? positions.count) / 3;
          for (let index = 0; index < positions.count; index++) {
            const projected = new Vector3().fromBufferAttribute(positions, index).applyMatrix4(world).project(camera);
            expect(Math.abs(projected.x)).toBeLessThanOrEqual(.98);
            expect(Math.abs(projected.y)).toBeLessThanOrEqual(.98);
            expect(Math.abs(projected.z)).toBeLessThanOrEqual(1);
          }
        });
        const id = `${nation}-hanging-lantern-${nation === "japanese" ? "torii" : "pailou"}`;
        const profile = ornamentalDecorationProfile(`roadDecoration:${id}:native`, detailed)!;
        expect(triangles).toBe(model.triangles);
        expect(triangles).toBeLessThanOrEqual(profile.cost);
        expect(triangles).toBeLessThanOrEqual(profile.farCost);
        const expected = nation === "japanese" ? [2068, 872] : [6720, 1388];
        expect(triangles).toBe(expected[detailed ? 0 : 1]);
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

it.each([true, false])("preserves original frames and physically joins gravity-hung lanterns at detail %s", detailed => {
  for (const nation of ["japanese", "chinese"] as const) {
    const recipe = createHangingLanternRoadRecipe(nation, detailed);
    const original = ROAD_DECORATIONS.find(definition => definition.family === recipe.definition.family)!;
    expect(recipe.frame.parts).toEqual(nation === "japanese"
      ? japaneseRoadToriiParts(original, detailed) : chineseRoadPailouParts(original, detailed));
    expect(ROAD_DECORATIONS.some(definition => definition.id === recipe.definition.id)).toBe(false);
    expect(recipe.suspensions).toHaveLength(2);
    for (const suspension of recipe.suspensions) {
      const { bearing, hook, lantern, lanternTop } = suspension;
      expect(hook[0]).toBe(bearing[0]); expect(hook[1]).toBe(bearing[1]);
      expect(lanternTop[0]).toBe(hook[0]); expect(lanternTop[2]).toBe(hook[2]);
      expect(lanternTop[1]).toBeLessThan(hook[1]);
      expect(lantern.position[1] + lantern.size[1] / 2).toBeCloseTo(lanternTop[1]);
      expect(Math.abs(lantern.position[0]) - lantern.size[0] / 2).toBeGreaterThan(original.opening!.width / 2);
      expect(lantern.swayPivot).toBeUndefined();
    }
    const braces = recipe.fittings.parts.filter(part => !("kind" in part) && part.shape === "box");
    for (const brace of braces) {
      if ("kind" in brace) throw new Error("Expected solid brace");
      const rotation = new Euler(...brace.rotation!);
      const top = new Vector3(0, Math.hypot(.23, .30) / 2, 0).applyEuler(rotation)
        .add(new Vector3(...brace.position));
      const bottom = new Vector3(0, -Math.hypot(.23, .30) / 2, 0).applyEuler(rotation)
        .add(new Vector3(...brace.position));
      expect(top.z).toBeCloseTo(.30); expect(bottom.z).toBeCloseTo(0);
      expect(top.y).toBeCloseTo(recipe.suspensions[0]!.bearing[1]);
    }
  }
});

it.each([true, false])("retains the actual open traffic prism, bounds and borrowed materials at detail %s", detailed => {
  const materials = createPlainBuildingMaterials(), borrowed = vi.fn();
  Object.values(materials).forEach(material => material.addEventListener("dispose", borrowed));
  try {
    for (const nation of ["japanese", "chinese"] as const) {
      const model = createHangingLanternRoadModel(nation, detailed, materials);
      try {
        model.root.updateMatrixWorld(true);
        const recipe = createHangingLanternRoadRecipe(nation, detailed), ray = new Raycaster();
        for (const x of [-.499, -.35, 0, .35, .499]) for (const y of [.05, .7, 1.4, 2.09]) {
          ray.set(new Vector3(x * recipe.definition.opening!.width, y, 2), new Vector3(0, 0, -1));
          expect(ray.intersectObject(model.root, true), `${nation}/${x}/${y}`).toHaveLength(0);
        }
        const bounds = new Box3().setFromObject(model.root);
        expect(bounds.min.y).toBeGreaterThanOrEqual(-.001);
        expect(bounds.max.z).toBeLessThan(.53);
        expect(model.triangles).toBeLessThanOrEqual(recipe.definition.triangles[detailed ? 0 : 1]);
        expect(model.root.children.every(part => part instanceof Mesh)).toBe(true);
        const privateMaterial = (model.root.getObjectByName("hanging_lantern_paper") as Mesh).material;
        expect(privateMaterial).not.toBe(materials.paint);
        const freed = vi.fn();
        if (Array.isArray(privateMaterial)) throw new Error("Expected a batched neutral paper surface");
        privateMaterial.addEventListener("dispose", freed);
        const geometriesFreed = model.root.children.map(part => {
          const callback = vi.fn(); (part as Mesh).geometry.addEventListener("dispose", callback); return callback;
        });
        model.dispose(); model.dispose();
        expect(freed).toHaveBeenCalledOnce(); expect(borrowed).not.toHaveBeenCalled();
        expect(geometriesFreed.every(callback => callback.mock.calls.length === 1)).toBe(true);
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});
