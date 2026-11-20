import { Mesh } from "three";
import { describe, expect, it } from "vitest";

import { buildNationalShuttleHull } from "../src/renderers/three/settlement/national-harbour-boat";
import { createThreeHarbourShuttles } from "../src/renderers/three/settlement/three-harbour-shuttles";
import { BOAT_TURN_RADIUS } from "../src/shared/settlement/harbour-boat-route";

const triangles = (mesh: Mesh) => (mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) / 3;

describe("nearby harbour boat renderer", () => {
  it.each([true, false])("keeps four distinct national silhouettes inside the validated turning disk (detailed=%s)", detailed => {
    const shapes = [];
    for (const nation of ["roman", "viking", "nubian", "japanese"] as const) {
      const geometry = buildNationalShuttleHull(nation, detailed), positions = geometry.attributes.position!;
      shapes.push(Array.from(positions.array).join(","));
      for (let vertex = 0; vertex < positions.count; vertex++)
        expect(Math.hypot(positions.getX(vertex), positions.getZ(vertex))).toBeLessThan(BOAT_TURN_RADIUS);
      expect(positions.count / 3).toBeLessThan(detailed ? 1200 : 400);
      geometry.dispose();
    }
    expect(new Set(shapes).size).toBe(4);
  });

  it("rebuilds only the changed nation's model and keeps the same claimed boat identity", () => {
    const view = createThreeHarbourShuttles(true);
    const frame = { boxes: 1, id: 7, laden: true, rowing: true, x: 1, y: -1, yaw: 0, z: 2 };
    view.update([{ ...frame, nation: "roman" }], 1);
    const roman = view.group.children[0];
    view.update([{ ...frame, nation: "roman" }], 2);
    expect(view.group.children[0]).toBe(roman);
    view.update([{ ...frame, nation: "nubian" }], 3);
    expect(view.group.children).toHaveLength(1);
    expect(view.group.children[0]).not.toBe(roman);
    expect(view.group.children[0]!.name).toBe("harbour_shuttle_nubian");
    view.dispose();
  });

  it.each([true, false])("draws the real barge with crates and rowers (detailed=%s)", detailed => {
    const view = createThreeHarbourShuttles(detailed);
    view.update([{ boxes: 3, id: 1, laden: true, rowing: true, x: 2, y: -1, yaw: .4, z: 3 }], 1.5);
    expect(view.group.children).toHaveLength(1);
    const hull = view.group.children[0]!.children[0] as Mesh;
    expect(triangles(hull)).toBeLessThan(detailed ? 1200 : 400);
    view.update([], 2);
    expect(view.group.children).toHaveLength(0);
    view.dispose();
  });
});
