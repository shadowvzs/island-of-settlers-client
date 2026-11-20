import { Mesh } from "three";
import { expect, it, vi } from "vitest";

import { MAPLE_LEAF_OUTLINE } from "../src/renderers/three/plants/maple-leaf-geometry";
import { createMapleProductionLeafGeometry } from "../src/renderers/three/plants/maple-production-leaf-geometry";
import { createMapleTreeMaterials, createMapleTreeTemplate } from "../src/renderers/three/plants/maple-tree-model";

it("retains real folded leaf relief, correct outward normals and canonical texture coordinates", () => {
  const leaf = { position: [0, 0, 0] as [number, number, number], yaw: 0, pitch: 0, roll: 0,
    length: .22, width: .19, seed: 73 };
  for (const detailed of [true, false]) {
    const geometry = createMapleProductionLeafGeometry(leaf, detailed);
    const positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
    const normal = geometry.getAttribute("normal");
    expect(geometry.index!.count / 3).toBe(detailed ? 8 : 5);
    expect(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y).toBeGreaterThan(.008);
    for (let vertex = 0; vertex < positions.count - 4; vertex++) {
      expect(normal.getY(vertex)).toBeGreaterThan(.9);
      expect(uv.getX(vertex)).toBeCloseTo(positions.getX(vertex) / leaf.width + .5, 6);
      expect(uv.getY(vertex)).toBeCloseTo(positions.getZ(vertex) / leaf.length, 6);
    }
    // Every lobe/sinus remains within the actual folded carrier, including the wider Minimal triangle.
    const side = (point: number[], a: number[], b: number[]) =>
      (point[0]! - b[0]!) * (a[1]! - b[1]!) - (a[0]! - b[0]!) * (point[1]! - b[1]!);
    const triangles = detailed ? 5 : 2;
    for (const [x, z] of MAPLE_LEAF_OUTLINE) {
      const inside = Array.from({ length: triangles }, (_, triangle) => {
        const points = [0, 1, 2].map(corner => {
          const index = geometry.index!.getX(triangle * 3 + corner);
          return [positions.getX(index) / leaf.width, positions.getZ(index) / leaf.length];
        });
        const signs = [side([x, z], points[0]!, points[1]!), side([x, z], points[1]!, points[2]!),
          side([x, z], points[2]!, points[0]!)];
        return !signs.some(value => value < -1e-6) || !signs.some(value => value > 1e-6);
      });
      expect(inside.some(Boolean)).toBe(true);
    }
    geometry.dispose();
  }
});

it("shares exact palmate alpha and veins between folded normal blades and distant blades", () => {
  const pack = createMapleTreeMaterials(), template = createMapleTreeTemplate(pack, true);
  const instance = template.create();
  expect(pack.foldedLeaves("red")).toBe(pack.farLeaves("red"));
  expect(pack.foldedLeaves("red").map).toBe(pack.leaves.map);
  expect(pack.foldedLeaves("red").normalMap).toBe(pack.leaves.normalMap);
  expect(pack.foldedLeaves("red").alphaMap).toBe(pack.farLeaves("yellow").alphaMap);
  expect(instance.root.children[1]!.name).toBe("maple-leaves");
  instance.dispose(); template.dispose(); pack.dispose();
});

it("leases one neutral geometry pair across colour-specific templates without premature disposal", () => {
  for (const tier of ["near", "far"] as const) {
    const pack = createMapleTreeMaterials(false);
    const templates = [0, 1, 2].map(() => createMapleTreeTemplate(pack, false, 1, tier));
    const instances = templates.map((template, index) =>
      template.create((["red", "orange", "yellow"] as const)[index]!));
    const leaves = instances.map(instance => instance.root.children[1] as Mesh);
    expect(new Set(leaves.map(mesh => mesh.geometry)).size).toBe(1);
    expect(new Set(leaves.map(mesh => mesh.material)).size).toBe(3);
    const disposed = vi.fn(); leaves[0]!.geometry.addEventListener("dispose", disposed);
    instances[0]!.dispose(); templates[0]!.dispose(); templates[0]!.dispose();
    expect(disposed).not.toHaveBeenCalled();
    instances[1]!.dispose(); templates[1]!.dispose();
    expect(disposed).not.toHaveBeenCalled();
    instances[2]!.dispose(); templates[2]!.dispose(); templates[2]!.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    pack.dispose();
    expect(() => createMapleTreeTemplate(pack, false, 1, tier)).toThrow(/disposed/);
  }
});
