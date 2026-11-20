import { describe, expect, it } from "vitest";

import { CART_STONE_LANE, HANDCART } from "../src/render-common/logistics/handcart-rules";
import { ROAD_STONE_WIDTH } from "../src/shared/settlement/road-types";
import { prepareRoadPath } from "../src/shared/settlement/settlement-road-travel";
import { addActor, createTrafficWorld } from "./helpers/traffic-scenario";

/** Two pullers starting at opposite ends of one straight road, their paths prepared like carts. */
const opposingCarts = (tier: "dirt" | "stone") => {
  const scene = createTrafficWorld(24);
  const west = { x: 2, z: 10 }, east = { x: 20, z: 10 };
  scene.roads.addRoad(west, east);
  if (tier === "stone") scene.roads.upgradeRoad(west, east, () => true);
  const eastbound = addActor(scene, { job: "Carrier", path: scene.roads.route(west, east)!.points, uid: 1,
    ...west });
  const westbound = addActor(scene, { job: "Carrier", path: scene.roads.route(east, west)!.points, uid: 2,
    ...east });
  for (const actor of [eastbound, westbound]) prepareRoadPath(scene.context, actor, 0, CART_STONE_LANE);
  /** Lateral offset of a path where it crosses the road's middle. */
  const middleOffset = (path: { x: number; z: number }[]) =>
    path.reduce((best, point) => Math.abs(point.x - 11) < Math.abs(best.x - 11) ? point : best).z - 10;
  return { eastbound: middleOffset(eastbound.path), westbound: middleOffset(westbound.path) };
};

describe("hand carts on 1.2 stone roads", () => {
  it("keep right so two opposing carts pass with a clearance between them", () => {
    const { eastbound, westbound } = opposingCarts("stone");
    expect(Math.abs(eastbound)).toBeCloseTo(CART_STONE_LANE, 5);
    expect(Math.sign(eastbound)).toBe(-Math.sign(westbound));
    // Centre to centre a full cart width plus the clearance: the bodies never overlap.
    expect(Math.abs(eastbound - westbound)).toBeGreaterThanOrEqual(HANDCART.width + HANDCART.clearance - 1e-6);
    // Each cart body's inner half stays on the paving; the outer wheel runs just past its edge.
    expect(CART_STONE_LANE - HANDCART.width / 2).toBeGreaterThan(0);
    expect(CART_STONE_LANE + HANDCART.width / 2 - ROAD_STONE_WIDTH / 2).toBeLessThan(.16);
  });

  it("keep to the centre of a 0.8 dirt road, where only one cart fits", () => {
    const { eastbound, westbound } = opposingCarts("dirt");
    expect(eastbound).toBeCloseTo(0, 6);
    expect(westbound).toBeCloseTo(0, 6);
  });
});
