import { Mesh, Vector3 } from "three";
import { expect, it } from "vitest";

import { createMapleTreeGraph } from "../src/render-common/plants/maple-tree-graph";
import { ornamentalPlantClearanceVolumes } from "../src/render-common/plants/ornamental-plant-clearance";
import { createMapleConnectedWood } from "../src/renderers/three/plants/maple-connected-wood";
import { mapleDisplayLimb } from "../src/renderers/three/plants/maple-display-limb";
import { createMapleProductionLeafGeometry } from "../src/renderers/three/plants/maple-production-leaf-geometry";
import { createMapleTreeMaterials, createMapleTreeTemplate } from "../src/renderers/three/plants/maple-tree-model";

it("renders every leaf bearing on a real chubby woody section, including terminal shoot nodes", () => {
  for (const detailed of [true, false]) for (let variant = 0; variant < 3; variant++) {
    const graph = createMapleTreeGraph(variant, detailed);
    const bearings = new Set<string>();
    graph.limbs.forEach((limb, index) => {
      if (limb.role !== "twig") return;
      const geometry = createMapleConnectedWood(graph, limb, detailed, index);
      const positions = geometry.getAttribute("position");
      const nodes = detailed ? limb.path : [limb.path[0]!, limb.path[1]!, limb.path[3]!];
      nodes.forEach((node, ring) => {
        const centre = new Vector3();
        for (let side = 0; side < 3; side++) centre.add(new Vector3().fromBufferAttribute(positions, ring * 4 + side));
        centre.divideScalar(3);
        expect(centre.distanceTo(new Vector3(...node))).toBeLessThan(1e-6);
        const radius = new Vector3().fromBufferAttribute(positions, ring * 4).distanceTo(centre);
        expect(radius).toBeGreaterThanOrEqual(.00119);
        bearings.add(node.join(":"));
      });
      geometry.dispose();
    });
    for (const leaf of graph.leaves) expect(bearings.has(leaf.position.join(":"))).toBe(true);
  }
});

it("builds actual three-sided petioles with finite side normals and blade-root overlap", () => {
  const leaf = { length: .22, pitch: 0, position: [0, 0, 0] as [number, number, number],
    roll: 0, seed: 31, width: .19, yaw: 0 };
  for (const detailed of [true, false]) {
    const geometry = createMapleProductionLeafGeometry(leaf, detailed);
    const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
    const start = positions.count - 4;
    const root = new Vector3();
    for (let side = 0; side < 3; side++) root.add(new Vector3().fromBufferAttribute(positions, start + side));
    expect(root.length()).toBeLessThan(1e-8);
    const sidePoints = [0, 1, 2].map(side => new Vector3().fromBufferAttribute(positions, start + side));
    const baseArea = sidePoints[1]!.clone().sub(sidePoints[0]!).cross(sidePoints[2]!.clone().sub(sidePoints[0]!)).length();
    expect(baseArea).toBeGreaterThan(1e-5);
    const tip = new Vector3().fromBufferAttribute(positions, start + 3);
    expect(tip.z).toBeCloseTo(leaf.length * .20);
    expect(tip.y).toBeGreaterThan(0);
    for (let index = start; index < positions.count; index++) {
      const normal = new Vector3().fromBufferAttribute(normals, index);
      expect(normal.length()).toBeGreaterThan(.99);
      expect(Number.isFinite(normal.x + normal.y + normal.z)).toBe(true);
    }
    geometry.dispose();
  }
});

it("keeps all new actual vertices inside unchanged canonical physical reservations and scoped budgets", () => {
  for (let variant = 0; variant < 3; variant++) {
    const volumes = ornamentalPlantClearanceVolumes({ species: "red-maple", variant: variant as 0 | 1 | 2,
      form: "standalone", harvestable: false, palette: "default", potted: false })!;
    for (const detailed of [true, false]) {
      const pack = createMapleTreeMaterials(detailed), template = createMapleTreeTemplate(pack, detailed, variant);
      const instance = template.create("orange");
      expect(template.graph.leaves.length).toBe(detailed ? 1812 : 764);
      expect(template.triangles).toBeLessThanOrEqual(detailed ? 24000 : 8500);
      expect(instance.root.children).toHaveLength(2);
      for (const mesh of instance.root.children as Mesh[]) {
        const positions = mesh.geometry.getAttribute("position");
        for (let index = 0; index < positions.count; index++) {
          const point = [positions.getX(index), positions.getY(index), positions.getZ(index)];
          expect(volumes.some(volume => point.every((value, axis) =>
            value >= volume.min[axis]! - 1e-5 && value <= volume.max[axis]! + 1e-5))).toBe(true);
        }
      }
      instance.dispose(); template.dispose(); pack.dispose();
    }
  }
});

it("transports trunk sections continuously through near-vertical bends without frame-axis flips", () => {
  for (const detailed of [true, false]) for (let variant = 0; variant < 3; variant++) {
    const graph = createMapleTreeGraph(variant, detailed), trunk = graph.limbs[0]!;
    const geometry = createMapleConnectedWood(graph, trunk, detailed, 0);
    const normals = geometry.getAttribute("normal");
    const sides = detailed ? 10 : 6;
    const rings = detailed ? 18 : 12;
    for (let ring = 1; ring <= rings; ring++) {
      const before = new Vector3().fromBufferAttribute(normals, (ring - 1) * (sides + 1));
      const after = new Vector3().fromBufferAttribute(normals, ring * (sides + 1));
      expect(before.dot(after)).toBeGreaterThan(.8);
    }
    geometry.dispose();
  }
});


it("gives roots different reaches, thicknesses and burial depths instead of a repeated spike star", () => {
  for (let variant = 0; variant < 3; variant++) {
    const graph = createMapleTreeGraph(variant);
    const roots = graph.limbs.map((limb, index) => mapleDisplayLimb(graph, limb, true, index))
      .filter(limb => limb.role === "root");
    const reach = roots.map(root => Math.hypot(root.path.at(-1)![0], root.path.at(-1)![2]));
    const radii = roots.map(root => root.radius), depth = roots.map(root => root.path.at(-1)![1]);
    expect(Math.max(...reach) / Math.min(...reach)).toBeGreaterThan(1.5);
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.5);
    expect(Math.max(...depth) - Math.min(...depth)).toBeGreaterThan(.04);
    expect(roots.every(root => root.path[0]![1] > 0 && root.path.at(-1)![1] < -.07)).toBe(true);
  }
});

it("renders broad organic trunk curvature without a sharp stump-like corner in either quality", () => {
  for (const detailed of [true, false]) for (let variant = 0; variant < 3; variant++) {
    const graph = createMapleTreeGraph(variant);
    const trunk = mapleDisplayLimb(graph, graph.limbs[0]!, detailed, 0);
    for (let node = 1; node < trunk.path.length - 1; node++) {
      const first = new Vector3(...trunk.path[node]!).sub(new Vector3(...trunk.path[node - 1]!));
      const second = new Vector3(...trunk.path[node + 1]!).sub(new Vector3(...trunk.path[node]!));
      expect(first.angleTo(second) * 180 / Math.PI).toBeLessThan(20);
    }
  }
});
