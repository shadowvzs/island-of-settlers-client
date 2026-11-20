import { BufferGeometry, Float32BufferAttribute, Group, type Object3D } from "three";
import { describe, expect, it } from "vitest";

import { SHIP_CLOTH_WIND } from "../src/render-common/ships/ship-cloth-wind";
import type { ShipFrame } from "../src/render-common/ships/ship-frame";
import {
  authoredSailWind, pennantWind, type PirateShipModels, pirateShipVariant
} from "../src/renderers/three/settlement/pirate-ship-models";
import { CLOTH_FORWARD } from "../src/renderers/three/settlement/ship-sails";
import { createThreeSettlementShips } from "../src/renderers/three/settlement/three-ships";

const geometryOf = (points: readonly (readonly number[])[]) => new BufferGeometry()
  .setAttribute("position", new Float32BufferAttribute(points.flat(), 3));
const windOf = (geometry: BufferGeometry, index: number) =>
  Array.from({ length: 4 }, (_, axis) => geometry.getAttribute(SHIP_CLOTH_WIND.attribute).getComponent(index, axis));
const named = (root: Object3D, name: string) => {
  let found = false;
  root.traverse(object => { found ||= object.name === name; });
  return found;
};

describe("pirate ship models", () => {
  it("alternates the two hulls by ship id", () => {
    expect([0, 1, 2, 3].map(pirateShipVariant)).toEqual(["blackwake", "redviper", "blackwake", "redviper"]);
  });

  it("pins the shallowest sail cloth and lets the deepest belly flutter most", () => {
    const sail = geometryOf([[0, 1, .1], [0, 2, .3], [0, 3, .1]]);
    authoredSailWind(sail, CLOTH_FORWARD);
    expect(windOf(sail, 0)[1]).toBeCloseTo(0);
    expect(windOf(sail, 1)[1]).toBeCloseTo(.2);
    expect(windOf(sail, 1)[2]).toBeCloseTo(1);
    expect(windOf(sail, 2)[2]).toBeCloseTo(0);
  });

  it("pins the pennant at the mast and frees its fly end", () => {
    const pennant = geometryOf([[0, 2, 0], [.2, 2, 0], [.4, 2.1, 0]]);
    pennantWind(pennant);
    expect([0, 1, 2].map(index => windOf(pennant, index)[2])).toEqual([0, .5, 1]);
  });

  it("draws the galley until the pirate models load, then the pirate model", () => {
    let ready = false;
    const models: PirateShipModels = {
      craft: () => ({ root: Object.assign(new Group(), { name: "pirate_ship_model" }), update: () => undefined }),
      dispose: () => undefined, isReady: () => ready, request: () => undefined
    };
    const layer = createThreeSettlementShips("minimal", undefined, undefined, undefined, models);
    const raider: ShipFrame = { cargoCount: 0, id: 1, livery: "enemy", phase: "sailing", x: 0, y: 0, yaw: 0, z: 0 };
    layer.update([raider], [], 0);
    expect(named(layer.group, "pirate_ship_model")).toBe(false);
    ready = true;
    layer.update([raider], [], 0);
    expect(named(layer.group, "pirate_ship_model")).toBe(true);
    expect(named(layer.group, "ship_hull")).toBe(false);
    layer.dispose();
  });
});
