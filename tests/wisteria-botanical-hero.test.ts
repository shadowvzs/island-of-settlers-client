import { Box3, type DataTexture, InstancedMesh, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { expect, it } from "vitest";

import { createWisteriaBotanicalMaterials } from "../src/renderers/three/wisteria-botanical-materials";
import { createWisteriaBotanicalTemplates } from "../src/renderers/three/wisteria-botanical-templates";
import { createWisteriaFlowerGeometry } from "../src/renderers/three/wisteria-flower-geometry";
import { createWisteriaHero } from "../src/renderers/three/wisteria-hero";
import { createWisteriaLeafGeometry } from "../src/renderers/three/wisteria-leaf-geometry";
import { createWisteriaWoodyGeometry } from "../src/renderers/three/wisteria-woody-geometry";

it("reference-study flower/leaf/old-wood modules have finite curved surfaces and grounded roots", () => {
  const flower = createWisteriaFlowerGeometry(), leaf = createWisteriaLeafGeometry();
  const wood = createWisteriaWoodyGeometry([[0, .01, 0], [.08, .14, .04], [.02, .35, -.02]], .05, .015, 24, 8, true);
  try {
    for (const geometry of [flower.petals, flower.calyx, flower.throat, leaf, wood]) {
      for (const key of ["position", "normal", "uv"])
        expect(Array.from(geometry.getAttribute(key).array).every(Number.isFinite), key).toBe(true);
    }
    expect(wood.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
    expect(leaf.boundingBox!.max.y).toBeCloseTo(1);
    expect(flower.petals.boundingBox!.max.z - flower.petals.boundingBox!.min.z).toBeGreaterThan(.3);
    const leafNormals = leaf.getAttribute("normal");
    for (let vertex = 0; vertex < leafNormals.count; vertex++)
      expect(Math.hypot(leafNormals.getX(vertex), leafNormals.getY(vertex), leafNormals.getZ(vertex))).toBeCloseTo(1);
    const triangles = (geometry: typeof leaf) => (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
    expect(triangles(leaf)).toBeGreaterThanOrEqual(8);
    expect(triangles(leaf)).toBeLessThanOrEqual(16);
    const positions = leaf.getAttribute("position"), a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let index = 0; index < leaf.index!.count; index += 3) {
      a.fromBufferAttribute(positions, leaf.index!.getX(index));
      b.fromBufferAttribute(positions, leaf.index!.getX(index + 1));
      c.fromBufferAttribute(positions, leaf.index!.getX(index + 2));
      expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(1e-16);
    }
  } finally { flower.dispose(); leaf.dispose(); wood.dispose(); }
});

it("the unregistered High hero assembles connected botanical instances with grounded roots and owned disposal", () => {
  const timber = new MeshStandardMaterial();
  const model = createWisteriaHero({ wood: timber } as Parameters<typeof createWisteriaHero>[0]);
  const bounds = new Box3().setFromObject(model.root);
  expect(model.counts).toEqual({ flowers: 560, buds: 140, leaflets: 702, racemes: 28, mainStems: 6 });
  expect(bounds.min.y).toBeGreaterThanOrEqual(0);
  let triangles = 0, surfaces = 0;
  model.root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    expect(Array.from(node.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
    triangles += (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) / 3 *
      (node instanceof InstancedMesh ? node.count : 1);
    surfaces++;
  });
  expect(surfaces).toBe(8);
  expect(model.topology.find(module => module.module === "wisteria_rachises_pedicels")!.visibleTriangles)
    .toBeLessThanOrEqual(10000);
  expect(Number.isFinite(triangles)).toBe(true);
  expect(triangles).toBeGreaterThan(0);
  model.dispose(); model.dispose();
  expect(model.root.children).toHaveLength(0);
  timber.dispose();
});

it("one neutral petal/vein/bark map set belongs to its reusable owner and releases its CPU images", () => {
  const owner = createWisteriaBotanicalMaterials();
  const maps = [owner.petal.map!, owner.leaf.map!, owner.bark.map!,
    owner.petal.normalMap!, owner.leaf.normalMap!, owner.bark.normalMap!] as DataTexture[];
  expect(owner.petal.color.toArray()).toEqual([1, 1, 1]);
  expect(new Set(maps).size).toBe(6);
  owner.dispose(); owner.dispose();
  for (const map of maps) expect(map.image.data).toBeNull();
});

it("arch/tree instances share neutral expensive geometry while flower tint and instance disposal remain independent", () => {
  const templates = createWisteriaBotanicalTemplates();
  const flowers = [{ position: [0, 1, 0] as const, yaw: 0, scale: .03 }];
  const purple = templates.instantiate(flowers, []), white = templates.instantiate(flowers, [], [1, 1, 1]);
  const petals = purple.root.getObjectByName("wisteria_open_petals") as InstancedMesh;
  const whitePetals = white.root.getObjectByName("wisteria_open_petals") as InstancedMesh;
  expect(petals.geometry).toBe(whitePetals.geometry);
  expect(petals.material).toBe(whitePetals.material);
  expect(petals.instanceColor!.getX(0)).not.toBe(whitePetals.instanceColor!.getX(0));
  let freed = 0; petals.geometry.addEventListener("dispose", () => { freed++; });
  purple.dispose(); expect(freed).toBe(0);
  expect(white.root.children).toHaveLength(5);
  templates.dispose(); templates.dispose(); white.dispose();
  expect(freed).toBe(1);
  expect(white.root.children).toHaveLength(0);
  expect(() => templates.instantiate(flowers, [])).toThrow("disposed");
});

it("woody tube bearing faces point outward rather than rendering the inside as flat ribbons", () => {
  const geometry = createWisteriaWoodyGeometry([[0, 0, 0], [.05, .5, .02], [0, 1, 0]], .08, .04, 12, 6);
  const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal");
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), outward = new Vector3();
  for (let index = 0; index < geometry.index!.count; index += 3) {
    const first = geometry.index!.getX(index);
    a.fromBufferAttribute(position, first);
    b.fromBufferAttribute(position, geometry.index!.getX(index + 1));
    c.fromBufferAttribute(position, geometry.index!.getX(index + 2));
    outward.fromBufferAttribute(normal, first);
    expect(b.sub(a).cross(c.sub(a)).normalize().dot(outward)).toBeGreaterThan(.5);
  }
  geometry.dispose();
});
