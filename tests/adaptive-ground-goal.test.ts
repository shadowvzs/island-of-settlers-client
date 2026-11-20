import { expect, it } from "vitest";

import { isGroundSegmentClear, searchGroundPath } from "../src/shared/settlement/settlement-navigation";
import { addPlot, createTrafficWorld } from "./helpers/traffic-scenario";

const fixture = () => {
  const scene = createTrafficWorld(48);
  scene.context.playerNation = "roman";
  addPlot(scene, { depth: 3, doorRotation: 0, typeId: 17, uid: 1, width: 3, x: 40.5, z: 40.5 });
  return scene;
};

it.each([
  { x: 16.375, z: 9.25 }, { x: 16.25, z: 9.5 }, { x: 16.5, z: 9.125 },
  { x: 16.404, z: 9.236 }
])("reaches an open-land goal with a different adaptive lattice phase: $x/$z", to => {
  const { context } = fixture();
  const from = { x: 8.125, z: 8.375 };
  const result = searchGroundPath(context, from, to);
  expect(result.status).toBe("found");
  expect(result.visits).toBeLessThan(1000);
  expect(result.path!.at(-1)).toEqual(to);
  let previous = from;
  for (const point of result.path!) {
    expect(isGroundSegmentClear(context, previous, point)).toBe(true);
    previous = point;
  }
});

it("does not use the final short edge to cross a thin obstacle", () => {
  const { context } = fixture();
  const from = { x: 8.125, z: 8.375 }, to = { x: 8.4, z: 8.4 };
  const blocked = (point: { x: number; z: number }) => point.x > 8.24 && point.x < 8.28;
  expect(isGroundSegmentClear(context, from, to, blocked)).toBe(false);
  const result = searchGroundPath(context, from, to, blocked, undefined, .5, 500);
  expect(result.path).toBeNull();
});
