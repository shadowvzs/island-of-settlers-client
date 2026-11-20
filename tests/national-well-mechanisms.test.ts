import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import type { WorkerNation } from "../src/render-common/workers/worker-nation";
import { createRomanDrawBucket } from "../src/renderers/three/buildings/roman-draw-bucket";
import { createRomanWellMechanism } from "../src/renderers/three/buildings/roman-well-mechanism";
import { createWorkerWellBucket } from "../src/renderers/three/worker-well-bucket";

const material = new MeshStandardMaterial();
const materials = new Proxy({} as Record<BuildingSurface, MeshStandardMaterial>, { get: () => material });
const nations: WorkerNation[] = ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"];
const disposeGeometry = (root: { traverse: (callback: (object: any) => void) => void }) => root.traverse(object => {
  if (object instanceof Mesh) object.geometry.dispose();
});

it.each(nations)("%s uses the same national bucket while drawing and carrying, without moving handles", nation => {
  for (const detailed of [false, true]) {
    const drawn = createRomanDrawBucket(materials, material, detailed, false, nation).root;
    const carried = createWorkerWellBucket(materials, detailed, false, nation);
    const shape = carried.getObjectByName("ware_geometry")!;
    expect(shape.children.length).toBe(drawn.children.length);
    for (let index = 0; index < drawn.children.length; index++) {
      const a = drawn.children[index] as Mesh, b = shape.children[index] as Mesh;
      expect(a.position.toArray()).toEqual(b.position.toArray());
      expect(a.geometry.getAttribute("position").array).toEqual(b.geometry.getAttribute("position").array);
    }
    expect(new Box3().setFromObject(drawn).getSize(new Vector3()).y).toBeCloseTo(.23, 6);
    expect(drawn.getObjectByName("well_bucket_water")!.position.y).toBe(.035);
    carried.userData.disposeOwnedMaterials();
    disposeGeometry(drawn); disposeGeometry(carried);
  }
});

it("keeps every national crank hand contact and full animation timing while varying the wheel silhouette", () => {
  const signatures = new Set<string>();
  for (const nation of nations) {
    const mechanism = createRomanWellMechanism(materials, true, nation);
    expect(mechanism.root.getObjectByName("well_crank_handle")!.position.toArray()).toEqual([-.075, .18, 0]);
    expect(mechanism.root.getObjectByName("well_hand_rope")).toBeUndefined();
    expect(mechanism.clip.duration).toBe(14);
    for (const seconds of [0, 1.5, 2, 12, 12.5, 13, 14]) {
      mechanism.update(seconds, seconds);
      const bucket = mechanism.root.getObjectByName("well_bucket")!;
      const expected = { x: 0, z: -.06 };
      expect(bucket.position.x).toBe(expected.x); expect(bucket.position.z).toBe(expected.z);
    }
    const wheel = mechanism.root.getObjectByName("well_windlass") ?? mechanism.root;
    signatures.add(JSON.stringify(wheel.children.map(object => [object.name, object.position.toArray()])));
    const water = mechanism.root.getObjectByName("well_trough_water") as Mesh;
    if (nation === "indigenous") {
      expect(water).toBeUndefined();
      expect(mechanism.clip.tracks.some(track => track.name.startsWith("well_trough_water"))).toBe(false);
    } else {
      expect(water.geometry.type).toBe(nation === "roman" || nation === "maya" ? "PlaneGeometry" : "CircleGeometry");
    }
    mechanism.dispose(); disposeGeometry(mechanism.root);
  }
  expect(signatures.size).toBe(8);
});
