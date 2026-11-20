import { CatmullRomCurve3, DataTexture, Mesh, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { createMapleTreeGraph } from "../src/render-common/plants/maple-tree-graph";
import { createMapleTreeMaterials, createMapleTreeTemplate } from "../src/renderers/three/plants/maple-tree-model";

it("retains real parent bearings and rooted ornamental identity in all three forms", () => {
  for (const detailed of [true, false]) for (let variant = 0; variant < 3; variant++) {
    const graph = createMapleTreeGraph(variant, detailed);
    expect(graph.species).toBe("maple-tree"); expect(graph.pot).toBeUndefined();
    expect(graph.needles).toEqual([]); expect(graph.blossoms).toEqual([]);
    graph.limbs.forEach((limb, index) => {
      if (limb.parent === null) return expect(index).toBe(0);
      expect(limb.parent).toBeLessThan(index);
      expect(graph.limbs[limb.parent]!.path).toContainEqual(limb.path[0]);
    });
    const roots = graph.limbs.filter(limb => limb.role === "root");
    expect(roots).toHaveLength(8);
    expect(roots.every(limb => limb.path.at(-1)![1] < 0)).toBe(true);
  }
});

it("attaches every opposite leaf pair to an actual shoot while exposing the lower trunk", () => {
  for (const detailed of [true, false]) {
    const graph = createMapleTreeGraph(0, detailed);
    const nodes = new Set(graph.limbs.filter(limb => limb.role === "twig")
      .flatMap(limb => limb.path.map(position => position.join(","))));
    expect(graph.leaves.length).toBe(detailed ? 1812 : 764);
    for (const leaf of graph.leaves) {
      expect(nodes.has(leaf.position.join(","))).toBe(true);
      expect(leaf.position[1]).toBeGreaterThan(1.3);
      expect(leaf.length).toBeGreaterThanOrEqual(.18);
      expect(leaf.width).toBeGreaterThanOrEqual(.16);
    }
  }
});

it("buries child start caps inside the parent's actual tapered curve bearing", () => {
  for (let variant = 0; variant < 3; variant++) {
    const graph = createMapleTreeGraph(variant);
    const profiles = graph.limbs.map(limb => new CatmullRomCurve3(limb.path.map(point => new Vector3(...point)))
      .getLengths(60));
    for (const limb of graph.limbs) {
      if (limb.parent === null) continue;
      const parent = graph.limbs[limb.parent]!;
      const node = parent.path.findIndex(point => point.every((value, axis) => value === limb.path[0]![axis]));
      const profile = profiles[limb.parent]!;
      const t = profile[Math.round(node / (parent.path.length - 1) * 60)]! / profile.at(-1)!;
      const bearing = parent.radius * (1 - t) ** .95 + parent.tipRadius * t;
      // The parent wood can vary its radius by approximately9%; do not expose a flat child cap.
      expect(limb.radius).toBeLessThanOrEqual(bearing * .90 + 1e-6);
    }
  }
});

it("keeps deterministic, structurally different upright and spreading silhouettes", () => {
  const graphs = [0, 1, 2].map(variant => createMapleTreeGraph(variant));
  expect(graphs[0]).toEqual(createMapleTreeGraph(0));
  expect(new Set(graphs.map(graph => JSON.stringify(graph.limbs[0]!.path))).size).toBe(3);
  expect(() => createMapleTreeGraph(3)).toThrow(/Unknown/);
});

it("preserves every owner-approved native C branch and leaf pose while reducing tessellation", () => {
  const accepted = [
    "3740db36c3b03021a04efecee166a03f6cf1f3209845cca54c5f7d364fb75aa9",
    "90b12d7d2346d636b842ebcc89a85b7e89c6a5cbce2dd7aa9917b4b39d752127",
    "707e47b1ae91ab25e7dff2d03cf98a3368a0b8355c9bf6132b214ae4fc1750f0",
    "cc1535e5d9c6c859a4a5d5a381ccba52d22fe3c7e0f05bb58647b390ea259051",
    "ec426788e02b8cb04fa1977cbc6c54f0b8672424de1297e00924e8b4546ec243",
    "4595b74a9bcbd97fa79bf08a279ef2c2fd730dc1c026921796c28d025be28466"
  ];
  const actual = [true, false].flatMap(detailed => [0, 1, 2].map(variant =>
    createHash("sha256").update(JSON.stringify(createMapleTreeGraph(variant, detailed))).digest("hex")));
  expect(actual).toEqual(accepted);
});

it("builds finite two-surface trees with cheaper Minimal topology", () => {
  for (let variant = 0; variant < 3; variant++) {
    const highPack = createMapleTreeMaterials(true), lowPack = createMapleTreeMaterials(false);
    const high = createMapleTreeTemplate(highPack, true, variant);
    const low = createMapleTreeTemplate(lowPack, false, variant);
    const instance = high.create();
    expect(instance.root.children).toHaveLength(2);
    expect(high.triangles).toBeLessThanOrEqual(24000); expect(low.triangles).toBeLessThanOrEqual(8500);
    expect(high.counts.foliage).toBe(1812 * 8); expect(low.counts.foliage).toBe(764 * 5);
    expect(low.triangles).toBeLessThan(high.triangles);
    for (const mesh of instance.root.children as Mesh[]) {
      const positions = mesh.geometry.getAttribute("position");
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      expect(mesh.geometry.boundingBox!.max.y).toBeGreaterThan(4);
    }
    instance.dispose(); high.dispose(); low.dispose(); highPack.dispose(); lowPack.dispose();
  }
});

it("shares one neutral geometry and map pair across yellow, orange and red palettes", () => {
  const pack = createMapleTreeMaterials(), template = createMapleTreeTemplate(pack, true);
  const models = [template.create("yellow"), template.create("orange"), template.create("red")];
  const leaves = models.map(model => model.root.children[1] as Mesh);
  expect(new Set(leaves.map(mesh => mesh.geometry)).size).toBe(1);
  const materials = models.map((_, index) => pack.leaves.material((["yellow", "orange", "red"] as const)[index]!));
  expect(new Set(materials.map(material => material.map)).size).toBe(1);
  expect(new Set(materials.map(material => material.normalMap)).size).toBe(1);
  expect(new Set(materials.map(material => material.color.getHex())).size).toBe(3);
  models.forEach(model => model.dispose()); template.dispose(); pack.dispose();
});

it("releases instances separately from exactly-once template geometry and shared materials", () => {
  const pack = createMapleTreeMaterials(), template = createMapleTreeTemplate(pack, false);
  const first = template.create(), second = template.create("red");
  const bark = (first.root.children[0] as Mesh).geometry;
  const leaf = (first.root.children[1] as Mesh).geometry;
  const geometryDisposed = vi.fn(), materialDisposed = vi.fn(), textureDisposed = vi.fn();
  const barkMap = pack.bark.map!;
  if (!(barkMap instanceof DataTexture)) throw new Error("Maple bark requires an owned data texture");
  expect(pack.bark.bumpMap).toBe(barkMap);
  barkMap.addEventListener("dispose", textureDisposed);
  bark.addEventListener("dispose", geometryDisposed); leaf.addEventListener("dispose", geometryDisposed);
  pack.bark.addEventListener("dispose", materialDisposed);
  first.dispose(); first.dispose();
  expect(geometryDisposed).not.toHaveBeenCalled(); expect(second.root.children).toHaveLength(2);
  second.dispose(); template.dispose(); template.dispose();
  expect(geometryDisposed).toHaveBeenCalledTimes(2); expect(materialDisposed).not.toHaveBeenCalled();
  pack.dispose(); pack.dispose(); expect(materialDisposed).toHaveBeenCalledOnce();
  expect(textureDisposed).toHaveBeenCalledOnce(); expect(barkMap.image.data).toBeNull();
  expect(() => template.create()).toThrow(/disposed/);
});
import { createHash } from "node:crypto";

