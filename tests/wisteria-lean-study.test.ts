import { MeshStandardMaterial, Vector3 } from "three";
import { expect, it } from "vitest";

import { mapWisteriaFlowerAtlas, mapWisteriaLeafAtlas } from "../src/renderers/three/wisteria-botanical-atlas-geometry";
import { createWisteriaFlowerGeometry } from "../src/renderers/three/wisteria-flower-geometry";
import { createWisteriaHero } from "../src/renderers/three/wisteria-hero";
import { createWisteriaLeafGeometry } from "../src/renderers/three/wisteria-leaf-geometry";
import { createWisteriaPetioleGeometry } from "../src/renderers/three/wisteria-petiole-geometry";

it("thin tissue study retains curved depth and finite atlas normals rather than adding tiny grid tessellation", () => {
  const flower = createWisteriaFlowerGeometry(true), leaf = createWisteriaLeafGeometry(true);
  const stalk = createWisteriaPetioleGeometry([0, 0, 0], [0, .01, 0], .0006);
  mapWisteriaFlowerAtlas(flower.petals); mapWisteriaLeafAtlas(leaf);
  expect(flower.petals.boundingBox!.max.z - flower.petals.boundingBox!.min.z).toBeGreaterThan(.3);
  expect(leaf.boundingBox!.max.z - leaf.boundingBox!.min.z).toBeGreaterThan(.05);
  for (const geometry of [flower.petals, leaf, stalk])
    for (const key of ["position", "normal", "uv"])
      expect(Array.from(geometry.getAttribute(key).array).every(Number.isFinite)).toBe(true);
  const p = stalk.getAttribute("position"), n = stalk.getAttribute("normal");
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), outward = new Vector3();
  for (let index = 0; index < stalk.index!.count; index += 3) {
    const first = stalk.index!.getX(index);
    a.fromBufferAttribute(p, first); b.fromBufferAttribute(p, stalk.index!.getX(index + 1));
    c.fromBufferAttribute(p, stalk.index!.getX(index + 2)); outward.fromBufferAttribute(n, first);
    expect(b.sub(a).cross(c.sub(a)).normalize().dot(outward)).toBeGreaterThan(.4);
  }
  flower.dispose(); leaf.dispose(); stalk.dispose();
});

it("opt-in High efficiency keeps every bloom/leaf/stem and leaves the full candidate available", () => {
  const wood = new MeshStandardMaterial();
  const full = createWisteriaHero({ wood } as Parameters<typeof createWisteriaHero>[0]);
  const lean = createWisteriaHero({ wood } as Parameters<typeof createWisteriaHero>[0], undefined, { lean: true });
  expect(lean.counts).toEqual(full.counts);
  expect(lean.botany.flowers).toEqual(full.botany.flowers);
  expect(lean.botany.leaves).toEqual(full.botany.leaves);
  const fullFlower = createWisteriaFlowerGeometry(), leanFlower = createWisteriaFlowerGeometry(true);
  expect(Array.from(leanFlower.petals.getAttribute("position").array).slice(0, 27))
    .toEqual(Array.from(fullFlower.petals.getAttribute("position").array).slice(0, 27));
  fullFlower.dispose(); leanFlower.dispose();
  const triangles = (model: typeof full) => model.topology.reduce((sum, module) => sum + module.visibleTriangles, 0);
  expect(triangles(lean)).toBeLessThan(triangles(full) * .67);
  // This is a CPU efficiency study; this assertion is not approval of a new production cap.
  full.dispose(); lean.dispose(); wood.dispose();
});
