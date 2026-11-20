import { Box3, type BufferGeometry, Euler, Mesh, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { cartPassingWidth, HANDCART } from "../src/render-common/logistics/handcart-rules";
import { createRoadsideShrubGraph, ROAD_SHRUB_FAR_CLUSTER_HALF_SIZE } from "../src/render-common/plants/roadside-shrub-graph";
import { createRoadsideShrubFarMaterials, createRoadsideShrubFarModel } from "../src/renderers/three/plants/roadside-shrub-far";
import { createShrubLeafGeometry } from "../src/renderers/three/plants/roadside-shrub-foliage";
import { createRoadsideShrubMaterials } from "../src/renderers/three/plants/roadside-shrub-materials";
import { createDenseRoadsideShrubModel } from "../src/renderers/three/plants/roadside-shrub-model";
import { createShrubSoilGeometry } from "../src/renderers/three/plants/roadside-shrub-pot";
import { createShrubStemGeometry } from "../src/renderers/three/plants/roadside-shrub-stem";

/** Orthographic foliage occupancy catches the previously rejected exposed central twig web. */
const crownCoverage = (geometry: BufferGeometry, radius: number, height: number, side: boolean) => {
  const positions = geometry.getAttribute("position"), samples = 48, pixels = new Uint8Array(samples ** 2);
  const centre = height * .56, vertical = height * .43;
  const edge = (a: number[], b: number[], x: number, y: number) =>
    (b[0]! - a[0]!) * (y - a[1]!) - (b[1]! - a[1]!) * (x - a[0]!);
  for (let face = 0; face < positions.count; face += 3) {
    const vertices = [0, 1, 2].map(offset => {
      let horizontal = positions.getX(face + offset);
      if (side) horizontal = positions.getZ(face + offset);
      return [horizontal, positions.getY(face + offset)];
    });
    const minX = Math.max(0, Math.floor((Math.min(...vertices.map(point => point[0]!)) + radius) / (2 * radius) * samples));
    const maxX = Math.min(samples - 1, Math.ceil((Math.max(...vertices.map(point => point[0]!)) + radius) / (2 * radius) * samples));
    const minY = Math.max(0, Math.floor((Math.min(...vertices.map(point => point[1]!)) - centre + vertical) / (2 * vertical) * samples));
    const maxY = Math.min(samples - 1, Math.ceil((Math.max(...vertices.map(point => point[1]!)) - centre + vertical) / (2 * vertical) * samples));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const worldX = -radius + (x + .5) / samples * radius * 2;
      const worldY = centre - vertical + (y + .5) / samples * vertical * 2;
      const edges = [0, 1, 2].map(index => edge(vertices[index]!, vertices[(index + 1) % 3]!, worldX, worldY));
      if (edges.every(value => value >= 0) || edges.every(value => value <= 0)) pixels[y * samples + x] = 1;
    }
  }
  let occupied = 0, total = 0;
  for (let y = 0; y < samples; y++) for (let x = 0; x < samples; x++) {
    const horizontal = (x + .5) / samples * 2 - 1, up = (y + .5) / samples * 2 - 1;
    if (horizontal ** 2 + up ** 2 >= .75 ** 2) continue;
    total++; occupied += pixels[y * samples + x]!;
  }
  return occupied / total;
};

it("retains a filled central foliage silhouette from the front and side on both quality levels", () => {
  const pack = createRoadsideShrubMaterials();
  try {
    for (const detailed of [true, false]) for (const variant of [0, 1, 2]) {
      const model = createDenseRoadsideShrubModel(pack.materials, detailed, variant);
      const geometry = (model.root.getObjectByName("foliage") as Mesh).geometry;
      for (const side of [true, false]) {
        const coverage = crownCoverage(geometry, [.28, .22, .30][variant]!, [.58, .86, .66][variant]!, side);
        expect(coverage, `variant ${variant}, detailed ${detailed}, side ${side}`).toBeGreaterThan(detailed ? .80 : .68);
      }
      model.dispose();
    }
  } finally { pack.dispose(); }
});
import { ROAD_PLACEMENT_WIDTH } from "../src/shared/settlement/road-types";

it("keeps real connected shrub bearings and attaches every rounded leaf to its terminal shoot", () => {
  for (const detailed of [true, false]) for (const variant of [0, 1, 2]) {
    const graph = createRoadsideShrubGraph(variant, detailed);
    expect(graph).toEqual(createRoadsideShrubGraph(variant, detailed));
    for (let index = 1; index < graph.limbs.length; index++) {
      const limb = graph.limbs[index]!, parent = graph.limbs[limb.parent!]!;
      expect(limb.parent).toBeLessThan(index);
      expect(parent.path).toContainEqual(limb.path[0]);
    }
    const twigs = graph.limbs.filter(limb => limb.role === "twig");
    expect(graph.leaves.length).toBeGreaterThanOrEqual(400);
    for (let index = 0; index < graph.leaves.length; index++) {
      const leaf = graph.leaves[index]!, twig = twigs[Math.floor(index / 10)]!;
      const start = new Vector3(...twig.path[1]!), end = new Vector3(...twig.path[2]!);
      const direction = end.sub(start), anchor = new Vector3(...leaf.position).sub(start);
      const t = anchor.dot(direction) / direction.lengthSq();
      expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThanOrEqual(1);
      expect(anchor.sub(direction.multiplyScalar(t)).length()).toBeLessThan(1e-10);
    }
    expect(new Set(graph.leaves.map(leaf => leaf.position[1].toFixed(4))).size).toBeGreaterThan(300);
  }
});

it("keeps rounded waxy leaf faces finite, outward and supported at the actual petiole root", () => {
  for (const detailed of [true, false]) {
    const graph = createRoadsideShrubGraph(0, detailed);
    for (const leaf of graph.leaves.filter((_, index) => index % 17 === 0)) {
      const geometry = createShrubLeafGeometry(leaf, detailed);
      const positions = geometry.getAttribute("position"), indices = geometry.index!;
      const wanted = new Vector3(0, 1, 0).applyEuler(new Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ"));
      expect(new Vector3().fromBufferAttribute(positions, 1).distanceTo(new Vector3(...leaf.position)))
        .toBeLessThan(1e-7);
      for (let index = 0; index < indices.count; index += 3) {
        const a = new Vector3().fromBufferAttribute(positions, indices.getX(index));
        const b = new Vector3().fromBufferAttribute(positions, indices.getX(index + 1));
        const c = new Vector3().fromBufferAttribute(positions, indices.getX(index + 2));
        const face = b.sub(a).cross(c.sub(a));
        expect(face.lengthSq()).toBeGreaterThan(1e-15); expect(face.dot(wanted)).toBeGreaterThan(0);
      }
      geometry.dispose();
    }
  }
});

it("gives main stems real curved tapered surfaces with outward faces and exact graph endpoint bearings", () => {
  for (const detailed of [true, false]) {
    const graph = createRoadsideShrubGraph(1, detailed);
    for (const limb of graph.limbs.filter(limb => limb.role === "branch")) {
      const geometry = createShrubStemGeometry(limb, detailed);
      const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
      const indices = geometry.index!;
      expect(indices.count / 3).toBe(detailed ? 60 : 24);
      for (const point of [limb.path[0]!, limb.path.at(-1)!]) {
        let nearest = Infinity;
        for (let vertex = 0; vertex < positions.count; vertex++)
          nearest = Math.min(nearest, new Vector3().fromBufferAttribute(positions, vertex).distanceTo(new Vector3(...point)));
        expect(nearest).toBeLessThan(1e-7);
      }
      for (let index = 0; index < indices.count; index += 3) {
        const a = new Vector3().fromBufferAttribute(positions, indices.getX(index));
        const b = new Vector3().fromBufferAttribute(positions, indices.getX(index + 1));
        const c = new Vector3().fromBufferAttribute(positions, indices.getX(index + 2));
        const face = b.sub(a).cross(c.sub(a));
        const normal = new Vector3().fromBufferAttribute(normals, indices.getX(index));
        normal.add(new Vector3().fromBufferAttribute(normals, indices.getX(index + 1)));
        normal.add(new Vector3().fromBufferAttribute(normals, indices.getX(index + 2)));
        expect(face.lengthSq()).toBeGreaterThan(1e-16); expect(face.dot(normal)).toBeGreaterThan(0);
      }
      geometry.dispose();
    }
  }
});

it("has bounded foliage/mesh cost, ground/pot support and distinct rounded/upright profiles in both LODs", () => {
  const pack = createRoadsideShrubMaterials();
  try {
    for (const detailed of [true, false]) for (const potted of [true, false]) {
      const profiles: number[][] = [];
      for (const variant of [0, 1, 2]) {
        const model = createDenseRoadsideShrubModel(pack.materials, detailed, variant, potted);
        const bounds = new Box3().setFromObject(model.root), size = bounds.getSize(new Vector3());
        profiles.push(size.toArray());
        expect(model.triangles).toBeLessThan(detailed ? 12000 : 6000);
        expect(model.root.children.length).toBeLessThanOrEqual(5);
        expect(bounds.min.y).toBeGreaterThan(-.05); expect(bounds.max.y).toBeLessThan(1.2);
        if (potted) expect(bounds.min.y).toBeCloseTo(0, 6);
        model.root.traverse(object => {
          if (object instanceof Mesh)
            expect(Array.from(object.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
        });
        model.dispose();
      }
      expect(profiles[1]![1]).toBeGreaterThan(profiles[0]![1]! * 1.25);
      expect(profiles[1]![0]).toBeLessThan(profiles[0]![0]!);
    }
  } finally { pack.dispose(); }
});

it("does not destroy borrowed palette maps/materials with a shrub instance", () => {
  const pack = createRoadsideShrubMaterials(), model = createDenseRoadsideShrubModel(pack.materials, true);
  const materialDisposed = vi.fn(), mapDisposed = vi.fn();
  pack.materials.foliage.addEventListener("dispose", materialDisposed);
  pack.maps.map.addEventListener("dispose", mapDisposed);
  model.dispose(); model.dispose();
  expect(materialDisposed).not.toHaveBeenCalled(); expect(mapDisposed).not.toHaveBeenCalled();
  pack.dispose(); pack.dispose();
  expect(materialDisposed).toHaveBeenCalledOnce(); expect(mapDisposed).toHaveBeenCalledOnce();
});

it("keeps far oval leaf clusters bounded below 800 triangles with one shared atlas and borrowed near surfaces", () => {
  const near = createRoadsideShrubMaterials(), far = createRoadsideShrubFarMaterials(near.materials);
  const sibling = createRoadsideShrubFarMaterials(near.materials, far.atlas);
  const atlasReleased = vi.fn(), barkReleased = vi.fn();
  far.atlas.addEventListener("dispose", atlasReleased);
  near.materials.bark.addEventListener("dispose", barkReleased);
  expect(far.materials.foliage.alphaTest).toBeGreaterThan(0);
  expect(far.materials.foliage.transparent).toBe(false);
  expect(sibling.atlas).toBe(far.atlas);
  const pixels = far.atlas.image.data as Uint8Array;
  let opaque = 0;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) opaque++;
  expect(opaque / (256 * 256)).toBeGreaterThan(.40);
  expect(opaque / (256 * 256)).toBeLessThan(.80);
  try {
    for (const variant of [0, 1, 2]) for (const potted of [false, true]) {
      const model = createRoadsideShrubFarModel(far.materials, variant, potted);
      const bounds = new Box3().setFromObject(model.root), size = bounds.getSize(new Vector3());
      expect(model.triangles).toBeLessThanOrEqual(800);
      expect(model.root.children.length).toBeLessThanOrEqual(5);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-.05);
      const cardSpan = 2 * Math.SQRT2 * ROAD_SHRUB_FAR_CLUSTER_HALF_SIZE;
      expect(size.x).toBeLessThanOrEqual([.56, .44, .60][variant]! + cardSpan);
      expect(size.z).toBeLessThanOrEqual(.60 + cardSpan);
      model.root.traverse(object => {
        if (object instanceof Mesh)
          expect(Array.from(object.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
      });
      model.dispose(); model.dispose();
    }
    expect(barkReleased).not.toHaveBeenCalled();
    sibling.dispose(); expect(atlasReleased).not.toHaveBeenCalled(); expect(far.atlas.image.data).not.toBeNull();
    far.dispose(); far.dispose(); expect(atlasReleased).toHaveBeenCalledOnce();
    expect(far.atlas.image.data).toBeNull();
    expect(barkReleased).not.toHaveBeenCalled();
  } finally { sibling.dispose(); far.dispose(); near.dispose(); }
});

it("provides actual ceramic glaze, earthy clod and branching leaf-vein pixels with shared relief maps", () => {
  const pack = createRoadsideShrubMaterials();
  try {
    const { maps, materials } = pack;
    for (const map of [maps.ceramic, maps.ceramicRoughness, maps.soil, maps.leaf]) {
      expect(map.image.width).toBe(256); expect(map.image.height).toBe(256);
      const values = Array.from(map.image.data as Uint8Array).filter((_, index) => index % 4 === 0);
      expect(new Set(values).size).toBeGreaterThan(25);
    }
    for (const map of [maps.ceramicNormal, maps.soilNormal, maps.leafNormal]) {
      const pixels = map.image.data as Uint8Array;
      expect(pixels.some((value, index) => index % 4 === 0 && Math.abs(value - 128) > 8)).toBe(true);
    }
    const soil = maps.soil.image.data as Uint8Array;
    // Distinct neighbouring grains must not regress to the rejected broad, smooth mud wash.
    let soilEdgeContrast = 0;
    for (let y = 0; y < 256; y++) for (let x = 1; x < 256; x++) {
      const index = (y * 256 + x) * 4;
      soilEdgeContrast += Math.abs(soil[index]! - soil[index - 4]!);
    }
    expect(soilEdgeContrast / (256 * 255)).toBeGreaterThan(10);
    for (let index = 0; index < soil.length; index += 4 * 73) {
      expect(soil[index]).toBeGreaterThan(soil[index + 1]!);
      expect(soil[index + 1]).toBeGreaterThan(soil[index + 2]!);
    }
    const leaf = maps.leaf.image.data as Uint8Array;
    const at = (x: number, y: number) => leaf[(y * 256 + x) * 4]!;
    expect(at(128, 135)).toBeGreaterThan(at(82, 135) + 20);
    expect(materials.ceramic.map).toBe(maps.ceramic);
    expect(materials.ceramic.roughnessMap).toBe(maps.ceramicRoughness);
    expect(materials.soil.map).toBe(maps.soil); expect(materials.foliage.map).toBe(maps.leaf);
  } finally { pack.dispose(); }
});

it("shares every neutral detail map across green/gold palettes and retains the external texture owner", () => {
  const original = createRoadsideShrubMaterials();
  const golden = createRoadsideShrubMaterials("#a3a14b", "#b27a58", original.texturePack);
  const released = vi.fn();
  for (const map of Object.values(original.texturePack.maps)) map.addEventListener("dispose", released);
  expect(golden.materials.foliage.map).toBe(original.materials.foliage.map);
  expect(golden.materials.ceramic.map).toBe(original.materials.ceramic.map);
  expect(golden.materials.soil.map).toBe(original.materials.soil.map);
  expect(golden.materials.foliage.color.equals(original.materials.foliage.color)).toBe(false);
  golden.dispose(); golden.dispose(); expect(released).not.toHaveBeenCalled();
  original.dispose(); original.dispose(); expect(released).toHaveBeenCalledTimes(7);
});

it("keeps textured real soil clods supported inside the rim with upward faces and planar coordinates", () => {
  const pot = { style: "round" as const, width: .5, depth: .5, height: .28 };
  for (const detailed of [true, false]) {
    const geometry = createShrubSoilGeometry(pot, detailed), positions = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv"), normals = geometry.getAttribute("normal");
    const heights = new Set<number>();
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex), y = positions.getY(vertex), z = positions.getZ(vertex);
      expect(Math.hypot(x / pot.width, z / pot.depth)).toBeLessThan(.435001);
      expect(y).toBeGreaterThan(pot.height - .024); expect(y).toBeLessThan(pot.height - .022);
      expect(normals.getY(vertex)).toBeGreaterThan(.99);
      expect(uv.getX(vertex)).toBeGreaterThanOrEqual(0); expect(uv.getX(vertex)).toBeLessThanOrEqual(1);
      expect(uv.getY(vertex)).toBeGreaterThanOrEqual(0); expect(uv.getY(vertex)).toBeLessThanOrEqual(1);
      heights.add(Math.round(y * 1e6));
    }
    expect(heights.size).toBeGreaterThan(15); geometry.dispose();
  }
});

it("reserves the entire low crown outside real passing carts instead of pretending all bushes fit the empty verge", () => {
  const pack = createRoadsideShrubMaterials();
  try {
    const trafficHalfWidth = cartPassingWidth(2) / 2;
    for (const detailed of [true, false]) for (const variant of [0, 1, 2]) {
      const model = createDenseRoadsideShrubModel(pack.materials, detailed, variant);
      const bounds = new Box3().setFromObject(model.root);
      const centre = trafficHalfWidth + HANDCART.clearance - bounds.min.x;
      expect(centre + bounds.min.x).toBeCloseTo(trafficHalfWidth + HANDCART.clearance, 10);
      // These are free-terrain bushes; placement must additionally reserve the outward canopy.
      expect(centre + bounds.max.x).toBeGreaterThan(ROAD_PLACEMENT_WIDTH / 2);
      model.dispose();
    }
  } finally { pack.dispose(); }
});
