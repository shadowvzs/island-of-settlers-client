import { Box3, Line3, Mesh, RepeatWrapping, SRGBColorSpace, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { createBonsaiElmGraph } from "../src/render-common/plants/bonsai-elm-graph";
import { createBonsaiPineGraph } from "../src/render-common/plants/bonsai-pine-graph";
import { createBonsaiElmBarkTextures } from "../src/renderers/three/plants/bonsai-elm-bark-textures";
import { createBonsaiElmLeafGeometry } from "../src/renderers/three/plants/bonsai-elm-leaf-geometry";
import { createBonsaiElmLeafTextures } from "../src/renderers/three/plants/bonsai-elm-leaf-textures";
import { createBonsaiElmMaterials, createBonsaiElmModel, createBonsaiModel } from
  "../src/renderers/three/plants/bonsai-model";
import { createBonsaiNeedleGeometry } from "../src/renderers/three/plants/bonsai-needle-geometry";
import { createBonsaiPotGeometries } from "../src/renderers/three/plants/bonsai-pot-geometry";
import { createOrnamentalTreeMaterials } from "../src/renderers/three/plants/ornamental-tree-materials";
import { createOrnamentalWoodGeometry } from "../src/renderers/three/plants/ornamental-wood-geometry";

describe("private mature bonsai candidate", () => {
  it("shares one neutral pinnate texture pack between palettes without disposing borrowed maps", () => {
    const textures = createBonsaiElmLeafTextures(), bark = createBonsaiElmBarkTextures(), released = vi.fn();
    const barkReleased = vi.fn();
    textures.map.addEventListener("dispose", released);
    bark.map.addEventListener("dispose", barkReleased);
    const green = createBonsaiElmMaterials(textures, bark), red = createBonsaiElmMaterials(textures, bark);
    red.materials.foliage.color.set("#b84837");
    expect(green.materials.foliage.map).toBe(red.materials.foliage.map);
    expect(green.materials.foliage.normalMap).toBe(red.materials.foliage.normalMap);
    expect(green.materials.bark.map).toBe(red.materials.bark.map);
    expect(green.materials.bark.normalMap).toBe(red.materials.bark.normalMap);
    expect(green.materials.foliage.color.equals(red.materials.foliage.color)).toBe(false);
    expect(green.materials.foliage.emissive.getHex()).toBe(0);
    expect(green.materials.foliage.customProgramCacheKey()).toBe(red.materials.foliage.customProgramCacheKey());
    green.dispose(); red.dispose();
    expect(released).not.toHaveBeenCalled();
    expect(barkReleased).not.toHaveBeenCalled();
    textures.dispose(); bark.dispose(); bark.dispose();
    expect(released).toHaveBeenCalledTimes(1);
    expect(barkReleased).toHaveBeenCalledTimes(1);
  });
  it("owns fine mottled gray/olive elm bark and repeating non-flat normals", () => {
    const bark = createBonsaiElmBarkTextures();
    try {
      const { data, height, width } = bark.map.image;
      expect([width, height]).toEqual([128, 256]);
      expect(bark.map.colorSpace).toBe(SRGBColorSpace);
      expect(bark.map.wrapS).toBe(RepeatWrapping); expect(bark.map.wrapT).toBe(RepeatWrapping);
      const pixels = data!;
      let red = 0, green = 0, olive = 0, warm = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        red += pixels[index]!; green += pixels[index + 1]!;
        if (pixels[index]! < pixels[index + 1]!) olive++;
        if (pixels[index]! > pixels[index + 1]! + 10) warm++;
      }
      expect(red / green).toBeGreaterThan(.9); expect(red / green).toBeLessThan(1.15);
      expect(olive).toBeGreaterThan(1000); expect(warm).toBeGreaterThan(1000);
      const normals = Array.from(bark.normalMap.image.data!);
      expect(Math.max(...normals.filter((_, index) => index % 4 === 0))).toBeGreaterThan(132);
      expect(Math.min(...normals.filter((_, index) => index % 4 === 0))).toBeLessThan(124);
    } finally { bark.dispose(); }
    expect(bark.map.image.data).toBeNull(); expect(bark.normalMap.image.data).toBeNull();
  });
  it.each([true, false])("keeps oval elm lamina winding upward and its fine-tooth mask readable, High=%s", detailed => {
    const leaf = createBonsaiElmGraph(0, detailed).leaves[0]!;
    const geometry = createBonsaiElmLeafGeometry({ ...leaf, position: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 }, detailed);
    const texture = createBonsaiElmLeafTextures();
    try {
      const positions = geometry.getAttribute("position"), indices = geometry.index!;
      for (let face = 0; face < indices.count; face += 3) {
        const points = [0, 1, 2].map(corner => new Vector3().fromBufferAttribute(positions, indices.getX(face + corner)));
        const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!));
        expect(normal.y).toBeGreaterThan(0);
      }
      const { data, height, width } = texture.map.image;
      expect(data![(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 3]).toBe(255);
      expect(data![(Math.floor(height / 2) * width) * 4 + 3]).toBe(0);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y).toBeGreaterThan(.005);
    } finally { geometry.dispose(); texture.dispose(); }
  });
  it.each([true, false])("keeps dense oval elm leaves physically bound to real woody segments, High=%s", detailed => {
    for (const variant of [0, 1, 2]) {
      const graph = createBonsaiElmGraph(variant, detailed);
      expect(graph.species).toBe("bonsai-elm");
      expect(graph.needles).toHaveLength(0);
      expect(graph.leaves.length).toBeGreaterThanOrEqual(detailed ? 300 : 240);
      const leafPositions = new Set(graph.leaves.map(leaf => leaf.position.map(value => value.toFixed(6)).join(":")));
      expect(leafPositions.size).toBeGreaterThanOrEqual(graph.leaves.length * .95);
      for (const limb of graph.limbs) {
        if (limb.parent === null) continue;
        expect(graph.limbs[limb.parent]!.path.some(point => point.every((value, axis) =>
          value === limb.path[0]![axis]))).toBe(true);
      }
      graph.leaves.forEach(leaf => {
        expect(leaf.length).toBeGreaterThanOrEqual(.065);
        expect(leaf.width).toBeGreaterThanOrEqual(.042);
        const position = new Vector3(...leaf.position);
        const attached = graph.limbs.some(limb => limb.role === "twig" && limb.path.slice(1).some((end, index) => {
          const line = new Line3(new Vector3(...limb.path[index]!), new Vector3(...end));
          return line.closestPointToPoint(position, true, new Vector3()).distanceToSquared(position) < 1e-16;
        }));
        expect(attached).toBe(true);
      });
      const owner = createBonsaiElmMaterials(), model = createBonsaiElmModel(owner.materials, detailed, variant);
      const released = vi.fn();
      owner.materials.foliage.map!.addEventListener("dispose", released);
      try {
        expect(model.root.children).toHaveLength(4);
        expect(new Box3().setFromObject(model.root).min.y).toBeCloseTo(0, 7);
        const unchangedVariantCap = detailed ? 9000 : 4500;
        const balancedWindsweptCap = detailed ? 10000 : 5000;
        expect(model.triangles).toBeLessThan(variant === 1 ? balancedWindsweptCap : unchangedVariantCap);
        const foliage = model.root.getObjectByName("foliage") as Mesh;
        expect(foliage.geometry.index!.count / 3).toBe(graph.leaves.length * (detailed ? 12 : 8));
        expect(foliage.material).toBe(owner.materials.foliage);
        expect(released).not.toHaveBeenCalled();
      } finally { model.dispose(); owner.dispose(); owner.dispose(); }
      expect(released).toHaveBeenCalledTimes(1);
    }
  });
  it.each([true, false])("balances only the slanted elm with two bearing left pads, High=%s", detailed => {
    const graph = createBonsaiElmGraph(1, detailed), trunk = graph.limbs[0]!;
    expect(trunk).toEqual(createBonsaiPineGraph(1, detailed, detailed ? 17 : 12).limbs[0]);
    const left = graph.limbs.filter(limb => limb.role === "branch" && limb.path.at(-1)![0] < -.15);
    const right = graph.limbs.filter(limb => limb.role === "branch" && limb.path.at(-1)![0] > 0);
    expect(left).toHaveLength(2); expect(right).toHaveLength(5);
    for (const branch of left) {
      expect(branch.parent).toBe(0);
      expect(trunk.path).toContainEqual(branch.path[0]);
      expect(branch.radius).toBeLessThan(.02);
      expect(branch.tipRadius).toBeLessThan(branch.radius);
    }
    const leftLeaves = graph.leaves.filter(leaf => leaf.position[0] < -.15);
    expect(leftLeaves.length).toBeGreaterThanOrEqual(20);
    expect(Math.max(...leftLeaves.map(leaf => leaf.position[1])) -
      Math.min(...leftLeaves.map(leaf => leaf.position[1]))).toBeGreaterThan(.15);
    // Production far templates use the same Minimal graph at both renderer qualities.
    const owner = createBonsaiElmMaterials(), far = createBonsaiElmModel(owner.materials, false, 1, true);
    try { expect(far.triangles).toBeLessThanOrEqual(1800); }
    finally { far.dispose(); owner.dispose(); }
  });
  it.each([true, false])("connects every structural joint to its actual parent, High=%s", detailed => {
    for (const variant of [0, 1, 2]) {
      const graph = createBonsaiPineGraph(variant, detailed);
      for (const limb of graph.limbs) {
        if (limb.parent === null) continue;
        expect(graph.limbs[limb.parent]!.path.some(point => point.every((value, axis) =>
          value === limb.path[0]![axis]))).toBe(true);
        const parent = graph.limbs[limb.parent]!;
        if (parent.role === "twig") expect(limb.radius).toBeLessThanOrEqual(parent.tipRadius);
      }
      const soilHeight = graph.pot!.height - .024;
      const roots = graph.limbs.filter(limb => limb.role === "root");
      expect(roots).toHaveLength(7);
      roots.forEach(root => {
        const terminal = root.path.at(-1)!;
        expect(terminal[1]).toBeLessThan(soilHeight);
        expect(Math.abs(terminal[0])).toBeLessThan(graph.pot!.width * .42);
        expect(Math.abs(terminal[2])).toBeLessThan(graph.pot!.depth * .42);
      });
      expect(graph.limbs[0]!.radius).toBeGreaterThan(.06);
      expect(graph.needles.length).toBe(detailed ? 475 : 180);
    }
  });

  it.each([true, false])("keeps woody tubes and actual three-dimensional needles outward-facing, High=%s", detailed => {
    const geometries = [0, 1, 2].flatMap(variant => {
      const graph = createBonsaiPineGraph(variant, detailed);
      return [createBonsaiNeedleGeometry(graph, detailed), ...graph.limbs.map(limb =>
        createOrnamentalWoodGeometry(limb, detailed))];
    });
    try {
      for (const geometry of geometries) {
        const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal");
        const indices = geometry.index!;
        for (let face = 0; face < indices.count; face += 3) {
          const vertices = [0, 1, 2].map(corner => indices.getX(face + corner));
          const points = vertices.map(vertex => new Vector3().fromBufferAttribute(position, vertex));
          const faceNormal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!));
          if (faceNormal.lengthSq() < 1e-20) continue;
          const smoothNormal = vertices.reduce((sum, vertex) =>
            sum.add(new Vector3().fromBufferAttribute(normal, vertex)), new Vector3());
          expect(faceNormal.dot(smoothNormal), `face ${face}`).toBeGreaterThan(0);
        }
      }
    } finally { geometries.forEach(geometry => geometry.dispose()); }
  });

  it.each([true, false])("rests four real pot feet on ground and fits soil within the rim, High=%s", detailed => {
    for (const variant of [0, 1, 2]) {
      const graph = createBonsaiPineGraph(variant, detailed), pot = graph.pot!;
      const geometries = createBonsaiPotGeometries(pot, detailed);
      try {
        const feet = geometries.ceramic.slice(-4);
        for (const foot of feet) {
          foot.computeBoundingBox();
          expect(foot.boundingBox!.min.y).toBeCloseTo(0, 7);
          expect(foot.boundingBox!.max.y).toBeCloseTo(.04, 7);
          const centre = foot.boundingBox!.getCenter(new Vector3());
          const bowlSupport = (centre.x / (pot.width * .35)) ** 2 + (centre.z / (pot.depth * .35)) ** 2;
          expect(bowlSupport).toBeLessThan(1);
        }
        geometries.soil.computeBoundingBox();
        const bounds = geometries.soil.boundingBox!;
        expect(bounds.min.y).toBeCloseTo(pot.height - .024, 7);
        expect(bounds.max.x).toBeLessThan(pot.width / 2);
        expect(bounds.max.z).toBeLessThan(pot.depth / 2);
      } finally { [...geometries.ceramic, geometries.soil].forEach(geometry => geometry.dispose()); }
    }
  });

  it.each([true, false])("merges four finite surfaces and disposes only owned geometry, High=%s", detailed => {
    const owner = createOrnamentalTreeMaterials(), borrowed = vi.fn(), textureReleased = vi.fn();
    owner.materials.bark.addEventListener("dispose", borrowed);
    owner.materials.bark.map!.addEventListener("dispose", textureReleased);
    try {
      const bounds: number[][] = [];
      for (const variant of [0, 1, 2]) {
        const model = createBonsaiModel(owner.materials, detailed, variant);
        expect(model.root.children).toHaveLength(4);
        // Candidate measurement ceiling only; this does not authorize a premium production budget.
        expect(model.triangles).toBeLessThan(detailed ? 27000 : 6000);
        const box = new Box3().setFromObject(model.root);
        bounds.push(box.getSize(new Vector3()).toArray());
        expect(box.min.y).toBeCloseTo(0, 7);
        const released = vi.fn();
        model.root.traverse(part => {
          if (!(part instanceof Mesh)) return;
          expect(Array.from(part.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
          part.geometry.addEventListener("dispose", released);
        });
        model.dispose(); model.dispose();
        expect(released).toHaveBeenCalledTimes(4);
      }
      expect(bounds[0]).not.toEqual(bounds[1]);
      expect(bounds[1]).not.toEqual(bounds[2]);
      expect(borrowed).not.toHaveBeenCalled();
      expect(textureReleased).not.toHaveBeenCalled();
    } finally { owner.dispose(); owner.dispose(); }
    expect(borrowed).toHaveBeenCalledTimes(1);
    expect(textureReleased).toHaveBeenCalledTimes(1);
  });
});
