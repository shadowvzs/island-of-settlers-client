import { describe, expect, it } from "vitest";

import { addApproachWalls } from "../src/render-common/bridges/bridge-approach-walls";
import { type BridgeRecipe, bridgeRecipeAdder } from "../src/render-common/bridges/bridge-recipe";
import { stoneArchBridgeRecipe } from "../src/render-common/bridges/stone-arch-bridge-recipe";
import { stoneSlabBridgeRecipe } from "../src/render-common/bridges/stone-slab-bridge-recipe";
import { BRIDGE_MAX_RAMP_LENGTH, bridgeApproaches } from "../src/shared/settlement/bridge-approaches";
import { createBridgeSurfaceHeight } from "../src/shared/settlement/bridge-surface";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import { crossing, floating } from "./helpers/bridge-recipe-support";

describe("stone bridges stand on masonry and ground", () => {
  for (const detailed of [true, false])
    for (const bank of [0.1, 0.6])
      for (const skew of [0, 0.4]) {
        const label = `${detailed ? "High" : "Minimal"}, bank ${bank}, skew ${skew}`;
        it(`leaves no slab bridge part floating (${label})`, () => {
          const input = crossing(3, bank, detailed, skew);
          expect(floating(stoneSlabBridgeRecipe(input), input)).toEqual([]);
        });
        it.each([5, 8, 12])(`leaves no %i-tile arch bridge part floating (${label})`, tiles => {
          const input = crossing(tiles, bank, detailed, skew);
          expect(floating(stoneArchBridgeRecipe(input), input)).toEqual([]);
        });
      }
});

describe("wing walls retain a raised shore ramp", () => {
  it("grounds both road edges of a low bank's ramp up to the ramp surface", () => {
    // Deck from x 4 to x 7 at z 5 over water at 0.3; the banks are 0.1 high, so the ramps climb.
    const deck: RoadSegment[] = Array.from({ length: 6 }, (_, tile) => ({
      bridge: { id: 1, kind: "stone", tile, tiles: 6, width: 2.6 },
      end: { x: 4.5 + tile * 0.5, z: 5 }, start: { x: 4 + tile * 0.5, z: 5 }, tier: "stone"
    }));
    const road = (from: number, to: number): RoadSegment[] => Array.from({ length: Math.abs(to - from) * 2 },
      (_, step) => {
        const x = from + Math.sign(to - from) * step * 0.5;
        return { end: { x: x + Math.sign(to - from) * 0.5, z: 5 }, start: { x, z: 5 }, tier: "stone" };
      });
    const segments = [...deck, ...road(4, 0), ...road(7, 11)];
    const terrain = (x: number) => (x > 4.3 && x < 6.7 ? -0.4 : 0.1);
    const ramp = createBridgeSurfaceHeight(segments, terrain, () => 0.3);
    const pieces = bridgeApproaches(segments, BRIDGE_MAX_RAMP_LENGTH).flatMap(approach => approach.pieces);
    const parts: BridgeRecipe["parts"] = [];
    for (const detailed of [true, false]) {
      parts.length = 0;
      addApproachWalls({ detailed, origin: { x: 4, z: 5 }, pieces, rampHeight: ramp, terrainHeight: terrain,
        unit: { x: 1, z: 0 } }, bridgeRecipeAdder(parts)(0));
      expect(parts.length).toBeGreaterThan(8);
      for (const { part } of parts) {
        if ("kind" in part) throw new Error("Wing walls use building parts");
        const x = 4 + part.position[0], z = 5 + part.position[2];
        const bottom = part.position[1] - part.size[1] / 2, top = part.position[1] + part.size[1] / 2;
        expect(bottom).toBeLessThan(terrain(x));
        expect(top).toBeCloseTo(ramp(x, 5)! - 0.02, 1);
        // Both edges: outside the flared ribbon, on either side of the road.
        expect(Math.abs(z - 5)).toBeGreaterThan(0.6);
      }
    }
  });
});
