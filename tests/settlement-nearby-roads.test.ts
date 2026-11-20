import { expect, it, vi } from "vitest";

import { connectNearbyBuildingEntrances } from "../src/shared/settlement/settlement-nearby-roads";
import type {
  SettlementBuilding,
  SettlementContext,
  SettlementPoint
} from "../src/shared/settlement/settlement-types";

const fixture = (distance = 0.5) => {
  const flag = { x: 10, z: 10 },
    road = { x: 10, z: 10 + distance };
  const storage = {
    uid: 0,
    typeId: 0,
    construction: 1,
    access: { x: 9.5, z: road.z }
  } as SettlementBuilding;
  const site = { uid: 1, typeId: 37, construction: 0, access: flag } as SettlementBuilding;
  const segments = [{ start: storage.access, end: road }];
  const planRoad = vi.fn((start: SettlementPoint, end: SettlementPoint) => ({
    points: [start, end],
    segments: []
  }));
  const context = {
    buildings: [storage, site],
    options: {
      roads: {
        segments: () => segments,
        planRoad,
        route: () => null
      }
    }
  } as unknown as SettlementContext;
  const connect = vi.fn((start: SettlementPoint, end: SettlementPoint) => {
    segments.push({ start, end });
    return true;
  });
  return { context, connect, flag, planRoad, road, segments, site };
};

it.each([0.5, 1])(
  "repairs a %s-tile entrance gap and then skips the connected building",
  (distance) => {
    const { connect, context, flag, road } = fixture(distance);
    connectNearbyBuildingEntrances(context, connect);
    expect(connect).toHaveBeenCalledExactlyOnceWith(flag, road);
    connect.mockClear();
    connectNearbyBuildingEntrances(context, connect);
    expect(connect).not.toHaveBeenCalled();
  }
);

it("does not build longer roads, unsafe links, or enemy/tower entrance roads", () => {
  const far = fixture(1.5);
  connectNearbyBuildingEntrances(far.context, far.connect);
  expect(far.connect).not.toHaveBeenCalled();
  const blocked = fixture();
  blocked.planRoad.mockReturnValue(null as never);
  connectNearbyBuildingEntrances(blocked.context, blocked.connect);
  expect(blocked.connect).not.toHaveBeenCalled();
  for (const fields of [{ militaryFaction: 1 }, { typeId: 4, bandit: { code: 1, layout: 0 } }]) {
    const test = fixture();
    Object.assign(test.site, fields);
    connectNearbyBuildingEntrances(test.context, test.connect);
    expect(test.connect).not.toHaveBeenCalled();
  }
});

it("joins an isolated entrance component to nearby storage-connected road", () => {
  const test = fixture();
  test.segments.push({ start: test.flag, end: { x: 10.5, z: 10 } });
  connectNearbyBuildingEntrances(test.context, test.connect);
  expect(test.connect).toHaveBeenCalledExactlyOnceWith(test.flag, test.road);
});
