import { expect, it } from "vitest";

import type { ObservationSubject } from "../src/app/camera-follow";
import { selectedRoutePoints } from "../src/app/selected-route";

it("shows only the actual upcoming route, advances with its index and caps work without changing the path", () => {
  const points = Array.from({ length: 200 }, (_, x) => ({ x, z: 10 }));
  let index = 4,
    samples = 0;
  const subject: ObservationSubject = {
    identity: {},
    label: "Carrier",
    detail: "Walking",
    x: 3.5,
    y: 2,
    z: 10,
    route: () => ({ points, index })
  };
  const height = () => {
    samples++;
    return 2;
  };
  expect(selectedRoutePoints(subject, height)).toHaveLength(65);
  expect(samples).toBe(64);
  expect(points).toHaveLength(200);
  index = 198;
  expect(selectedRoutePoints(subject, height).map((point) => point.x)).toEqual([3.5, 198, 199]);
  index = 200;
  expect(selectedRoutePoints(subject, height)).toEqual([]);
  index = -1;
  expect(selectedRoutePoints(subject, height)).toEqual([]);
  delete subject.route;
  expect(selectedRoutePoints(subject, height)).toEqual([]);
});
