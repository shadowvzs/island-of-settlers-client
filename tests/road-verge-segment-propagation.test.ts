import { expect, it } from "vitest";

import { flareBridgeApproaches } from "../src/shared/settlement/bridge-approaches";
import { createBuildingRoadApproaches } from "../src/shared/settlement/building-road-approaches";
import { fitStoneRoadWidths } from "../src/shared/settlement/road-fitted-widths";
import type { RoadSegment } from "../src/shared/settlement/road-types";

const plantedRoad = (z: number): RoadSegment => ({
  end: { x: 8, z }, start: { x: 8, z: z - .5 }, tier: "stone", verge: "flowers"
});

it("keeps a planted verge through the building approach and width fitting steps", () => {
  const [approach] = createBuildingRoadApproaches([plantedRoad(4)], []);
  expect(approach!.verge).toBe("flowers");
  const [fitted] = fitStoneRoadWidths([plantedRoad(4)], { isBlocked: () => true });
  expect(fitted!.verge).toBe("flowers");
});

it("keeps a planted verge on the shore road flared at a bridge end", () => {
  const deck: RoadSegment[] = Array.from({ length: 3 }, (_, tile) => ({
    end: { x: 8, z: 4 + (tile + 1) * .5 },
    start: { x: 8, z: 4 + tile * .5 },
    tier: "dirt",
    bridge: { id: 1, kind: "wood", width: 2.6, tile, tiles: 3 }
  }));
  const shore = plantedRoad(4);
  const flared = flareBridgeApproaches([shore, ...deck]);
  expect(flared.find(segment => !segment.bridge)).toMatchObject({
    verge: "flowers", start: shore.start, end: shore.end
  });
});
