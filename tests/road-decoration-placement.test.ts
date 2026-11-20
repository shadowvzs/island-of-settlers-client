import { expect, it } from "vitest";

import { planRoadDecorationPlacement, type RoadDecorationPlacementContext,
  type RoadDecorationPlacementRequest } from "../src/shared/settlement/road-decoration-placement";

const road = { start: { x: 5, z: 4 }, end: { x: 5, z: 4.5 }, tier: "stone" as const };
const request: RoadDecorationPlacementRequest = { decoration: "roman-rusticated-arch", position: { x: 5, z: 4.25 }, yaw: 0 };
const context = (): RoadDecorationPlacementContext => ({ nation: "roman", roads: [road],
  heightAt: () => 0, isOwned: () => true, isFree: () => true });

it("supports absolute owned terrain without a road and preserves arbitrary position/yaw", () => {
  const standalone = { ...request, position: { x: 13.37, z: 8.24 }, yaw: Math.PI / 4 };
  const result = planRoadDecorationPlacement(standalone, { ...context(), roads: [] });
  expect(result).toMatchObject({ ok: true, position: [13.37, 0, 8.24], yaw: Math.PI / 4 });
  expect(planRoadDecorationPlacement(request, { ...context(), nation: "japanese" }).ok).toBe(true);
  expect(planRoadDecorationPlacement({ ...request, yaw: Number.NaN }, context()).ok).toBe(false);
});

it("allows an actually open portal across traffic and refuses blocked, reserved, unowned or unsupported solids", () => {
  const base = context(), good = planRoadDecorationPlacement(request, base);
  expect(good.ok).toBe(true);
  if (!good.ok) throw new Error("Expected valid fixture");
  expect(good.supports).toHaveLength(2); expect(good).not.toHaveProperty("cost");
  expect(planRoadDecorationPlacement(request, { ...base, isFree: () => false }).ok).toBe(false);
  expect(planRoadDecorationPlacement(request, { ...base, canPlaceGround: () => false }).ok).toBe(false);
  expect(planRoadDecorationPlacement(request, { ...base, isOwned: () => false }).ok).toBe(false);
  expect(planRoadDecorationPlacement(request, { ...base, heightAt: x => x > 5 ? .1 : 0 }).ok).toBe(false);
});

it("a lantern follows its absolute position and refuses intruding into a live cart corridor", () => {
  const lantern = { ...request, decoration: "japanese-stone-lantern" };
  const base = { ...context(), nation: "japanese" as const };
  expect(planRoadDecorationPlacement(lantern, base)).toEqual({ ok: false, reason: "road-traffic-obstructed" });
  const result = planRoadDecorationPlacement({ ...lantern, position: { x: 6.1, z: 4.25 } }, base);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected valid lantern fixture");
  expect(result.position).toEqual([6.1, 0, 4.25]);
  expect(Math.min(...result.volumes.map(box => box.min[0]))).toBeGreaterThanOrEqual(5 + .81);
});

it("refuses a potted sole resting unevenly even on a shallow slope allowed by broad support tolerance", () => {
  const pot = { ...request, position: { x: 6.1, z: 4.25 }, decoration: "indigenous-flower-pot" };
  const base = { ...context(), nation: "indigenous" as const };
  expect(planRoadDecorationPlacement(pot, base).ok).toBe(true);
  expect(planRoadDecorationPlacement(pot, { ...base, heightAt: (_x, z) => (z - 4.25) * .02 }))
    .toEqual({ ok: false, reason: "uneven-support-ground" });
});

it("keeps junction turning pockets clear even when the straight portal opening would pass", () => {
  const crossroads = [
    { start: { x: 5, z: 4.25 }, end: { x: 5, z: 5 }, tier: "stone" as const },
    { start: { x: 5, z: 4.25 }, end: { x: 6, z: 4.25 }, tier: "stone" as const }
  ];
  expect(planRoadDecorationPlacement(request, { ...context(), roads: crossroads })).toEqual({ ok: false, reason: "road-traffic-obstructed" });
});
