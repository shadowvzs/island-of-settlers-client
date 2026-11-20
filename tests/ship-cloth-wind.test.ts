import { type BufferAttribute, Mesh, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { SHIP_CLOTH_WIND, shipClothBillowRatio, shipClothFill,
  shipClothStrength } from "../src/render-common/ships/ship-cloth-wind";
import { createShipClothWind, STATIC_SHIP_CLOTH } from "../src/renderers/three/settlement/ship-cloth-wind";
import { SHIP_STYLES, type ShipStyle } from "../src/renderers/three/settlement/ship-styles";
import { createThreeSettlementShips } from "../src/renderers/three/settlement/three-ships";
import { deformShipCloth, SHIP_CLOTH_TEST_WINDS } from "./helpers/ship-cloth-deform";

const STYLES = Object.keys(SHIP_STYLES) as ShipStyle[];
/** Main mast radius in ship space (kit pole scaled .03) plus a little air. */
const MAST_CLEARANCE = .035;

/** Least horizontal distance of the cloth from the main mast axis (x = 0, z = 0) along its height. */
const mastDistance = (positions: BufferAttribute) => {
  let least = Infinity;
  for (let index = 0; index < positions.count; index++)
    if (positions.getY(index) < 2.3) least = Math.min(least, Math.hypot(positions.getX(index), positions.getZ(index)));
  return least;
};

describe("SHIP-WIND sail cloth", () => {
  it("fills with the wind astern or abeam and luffs head to wind; calm clear weather keeps the rest shape", () => {
    expect(shipClothFill(0, 1)).toBe(1);
    expect(shipClothFill(1, 0)).toBe(1);
    expect(shipClothFill(0, -1)).toBe(0);
    const clear = shipClothStrength(Math.hypot(.8, .35)), storm = shipClothStrength(Math.hypot(.8, .35) * 2.4);
    expect(storm).toBe(1);
    const ratio = (localZ: number, strength: number) =>
      shipClothBillowRatio({ localX: 0, localZ, phase: 0, strength, time: 0 });
    expect(ratio(1, clear)).toBeCloseTo(1, 1);
    expect(ratio(1, storm)).toBeGreaterThan(1.4);
    expect(ratio(-1, clear)).toBeLessThan(.5);
  });

  it.each(STYLES)("%s: the blown cloth keeps clear of the main mast and its pinned edges stay put", style => {
    const geometry = SHIP_STYLES[style].createSail(true);
    const rest = geometry.getAttribute("position") as BufferAttribute, blown = rest.clone();
    const wind = geometry.getAttribute(SHIP_CLOTH_WIND.attribute);
    expect(wind.count).toBe(rest.count);
    expect(Array.from(wind.array).every(Number.isFinite)).toBe(true);
    const restDistance = mastDistance(rest);
    for (const state of SHIP_CLOTH_TEST_WINDS) {
      deformShipCloth(geometry, state, blown);
      expect(mastDistance(blown)).toBeGreaterThanOrEqual(Math.min(restDistance, MAST_CLEARANCE));
      for (let index = 0; index < rest.count; index++) {
        expect(blown.getY(index)).toBe(rest.getY(index));
        if (wind.getY(index) || wind.getZ(index)) continue;
        expect(blown.getX(index)).toBeCloseTo(rest.getX(index), 9);
        expect(blown.getZ(index)).toBeCloseTo(rest.getZ(index), 9);
      }
    }
    geometry.dispose();
  });

  it("patches only the sail materials when on, and leaves plain rest cloth when off", () => {
    const ship = { cargoCount: 0, id: 1, phase: "idle" as const, x: 0, y: 0, yaw: 0, z: 0 };
    const sailOf = (layer: ReturnType<typeof createThreeSettlementShips>) => {
      layer.update([ship], [], 0, { windDirection: .4, windStrength: .9 });
      let sail: Mesh | undefined;
      layer.group.traverse(object => { if (object instanceof Mesh && object.name === "ship_sail") sail = object; });
      return sail!;
    };
    const windy = createThreeSettlementShips("high", undefined, undefined, createShipClothWind());
    const blown = sailOf(windy);
    expect(blown.geometry.getAttribute(SHIP_CLOTH_WIND.attribute)).toBeDefined();
    expect((blown.material as MeshStandardMaterial).customProgramCacheKey()).toBe("ship-cloth-wind-v1");
    expect((blown.material as MeshStandardMaterial).userData.shipClothWind?.uniform).toBeDefined();
    windy.dispose();
    const still = createThreeSettlementShips("minimal", undefined, undefined, STATIC_SHIP_CLOTH);
    const rest = sailOf(still);
    expect(rest.geometry.getAttribute(SHIP_CLOTH_WIND.attribute)).toBeUndefined();
    expect((rest.material as MeshStandardMaterial).customProgramCacheKey()).not.toBe("ship-cloth-wind-v1");
    still.dispose();
  });
});
