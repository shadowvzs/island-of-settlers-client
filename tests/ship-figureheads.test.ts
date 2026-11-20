import { Box3, Group, Mesh, type Object3D } from "three";
import { describe, expect, it } from "vitest";

import type { ShipFrame } from "../src/render-common/ships/ship-frame";
import { shipFigureheadKind } from "../src/renderers/three/settlement/ship-figureheads";
import { createThreeSettlementShips } from "../src/renderers/three/settlement/three-ships";

const ship: ShipFrame = { cargoCount: 0, id: 1, phase: "idle", x: 0, y: 0, yaw: 0, z: 0 };

const shownFigurehead = (root: Object3D) => {
  const figurehead = root.getObjectByName("ship_figurehead")!;
  return figurehead.children.filter(child => child.visible).map(child => child.name);
};
const triangles = (group: Object3D) => {
  let count = 0;
  group.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    count += (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
  });
  return count;
};

describe("ship figureheads by livery", () => {
  it("keeps the player's eagle, gives raiders a serpent and neutral ships a plain stem", () => {
    expect(shipFigureheadKind()).toBe("eagle");
    expect(shipFigureheadKind("enemy")).toBe("serpent");
    expect(shipFigureheadKind("neutral")).toBe("stem");
  });

  it("gives Viking player ships the dragon, never raiders or neutral ships", () => {
    expect(shipFigureheadKind(undefined, "viking")).toBe("dragon");
    expect(shipFigureheadKind("enemy", "viking")).toBe("serpent");
    expect(shipFigureheadKind("neutral", "viking")).toBe("stem");
  });

  it.each(["high", "minimal"] as const)("shows one figurehead per ship on %s", quality => {
    const layer = createThreeSettlementShips(quality);
    layer.update([ship, { ...ship, id: 2, livery: "enemy", x: 20 }, { ...ship, id: 3, livery: "neutral", x: 40 }],
      [], 0);
    const roots = ["ship-1", "ship-2", "ship-3"].map(name => layer.group.getObjectByName(name)!);
    expect(roots.map(shownFigurehead)).toEqual([
      ["ship_figurehead_eagle"], ["ship_figurehead_serpent"], ["ship_figurehead_stem"]
    ]);
    // The eagle is no longer baked into the shared hull batches.
    const hull = roots[1]!.children.find(child => child.name === "ship_hull")!;
    hull.traverse(object => expect(object.name).not.toBe("eagle_sculpture_jerryfisher"));
    // A captured or re-liveried ship changes its figurehead.
    layer.update([{ ...ship, livery: "enemy" }], [], 0);
    expect(shownFigurehead(layer.group.getObjectByName("ship-1")!)).toEqual(["ship_figurehead_serpent"]);
    layer.dispose();
  });

  it("carves the serpent on the stem head within its budget (Minimal far cheaper)", () => {
    const sizes = (["high", "minimal"] as const).map(quality => {
      const layer = createThreeSettlementShips(quality);
      layer.update([{ ...ship, livery: "enemy" }], [], 0);
      layer.group.updateMatrixWorld(true);
      const serpent = layer.group.getObjectByName("ship_figurehead_serpent") as Group;
      const bounds = new Box3().setFromObject(serpent);
      const result = { bounds, triangles: triangles(serpent) };
      layer.dispose();
      return result;
    });
    expect(sizes[0]!.triangles).toBeGreaterThan(sizes[1]!.triangles * 2);
    expect(sizes[0]!.triangles).toBeLessThan(2500);
    // Sits on the raider galley's stem head (scaled ship space), inside the shared bow envelope.
    for (const { bounds } of sizes) {
      expect(bounds.min.z / 4).toBeGreaterThan(.94);
      expect(bounds.max.z / 4).toBeLessThan(1.35);
      expect(bounds.max.y / 4).toBeLessThan(.72);
      expect(bounds.min.y / 4).toBeGreaterThan(.36);
    }
  });
});
