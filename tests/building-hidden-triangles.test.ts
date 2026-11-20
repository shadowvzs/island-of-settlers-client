import { BoxGeometry } from "three";
import { describe, expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { buildingSolidBoxes, removeHiddenBuildingTriangles }
  from "../src/renderers/three/buildings/building-hidden-triangles";

const box = (overrides: Partial<BuildingPart> = {}): BuildingPart => ({
  position: [0, 0, 0], shape: "box", size: [1, 1, 1], stage: 1, surface: "stone", ...overrides
});
const triangles = (geometry: BoxGeometry) => (geometry.index?.count ?? geometry.attributes.position!.count) / 3;

describe("provably hidden Minimal building faces", () => {
  it("drops fully buried geometry while preserving exposed and coplanar faces", () => {
    const outer = box({ size: [2, 2, 2] }), inner = box();
    const buried = new BoxGeometry(1, 1, 1);
    removeHiddenBuildingTriangles(buried, inner, buildingSolidBoxes([outer, inner]));
    expect(triangles(buried)).toBe(0);
    const exposed = new BoxGeometry(2, 2, 2);
    removeHiddenBuildingTriangles(exposed, outer, buildingSolidBoxes([outer, inner]));
    expect(triangles(exposed)).toBe(12);
    const coplanar = new BoxGeometry(1, 1, 1);
    removeHiddenBuildingTriangles(coplanar, inner, buildingSolidBoxes([box()]));
    expect(triangles(coplanar)).toBe(12);
    for (const geometry of [buried, exposed, coplanar]) geometry.dispose();
  });

  it("removes buried faces whose edges touch the solid boundary, retaining boundary planes", () => {
    const part = box({ size: [2, 1, 1] }), geometry = new BoxGeometry(2, 1, 1);
    removeHiddenBuildingTriangles(geometry, part, buildingSolidBoxes([box({ size: [2, 2, 2] })]));
    expect(triangles(geometry)).toBe(4);
    geometry.dispose();
  });

  it("never treats rotated, tapered, moving or changing stock as solid occlusion proofs", () => {
    expect(buildingSolidBoxes([
      box({ rotation: [0, .2, 0] }), box({ topScale: [.5, 1, .5] }),
      box({ swayPivot: [0, 0, 0] }), box({ stock: { ware: "planks", slot: 0 } })
    ])).toEqual([]);
    const stock = box({ stock: { ware: "planks", slot: 0 } }), geometry = new BoxGeometry(1, 1, 1);
    removeHiddenBuildingTriangles(geometry, stock, buildingSolidBoxes([box({ size: [2, 2, 2] })]));
    expect(triangles(geometry)).toBe(12);
    geometry.dispose();
  });

  it("retains every articulated catapult face and never uses moving rigging as an occluder", () => {
    const moving = ["arm", "loaded", "crank", "frame", "trigger", "hatch"] as const;
    const solid = buildingSolidBoxes([box({ size: [2, 2, 2] })]);
    for (const catapultPart of moving) {
      const part = box({ catapultPart }), geometry = new BoxGeometry(1, 1, 1);
      expect(buildingSolidBoxes([part])).toEqual([]);
      removeHiddenBuildingTriangles(geometry, part, solid);
      expect(triangles(geometry)).toBe(12);
      geometry.dispose();
    }
    expect(buildingSolidBoxes([box({ windCordSlot: 0 }), box({ drinkTool: "persian" })])).toEqual([]);
  });

  it("uses actual construction phases so late fit-out cannot erase an earlier roof", () => {
    const roof = box({ stage: 4, surface: "roof" });
    const fitout = box({ size: [2, 2, 2], stage: 3, surface: "wood" });
    const geometry = new BoxGeometry(1, 1, 1);
    removeHiddenBuildingTriangles(geometry, roof, buildingSolidBoxes([fitout]));
    expect(triangles(geometry)).toBe(12);
    geometry.dispose();
  });
});
