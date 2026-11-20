import { expect, it, vi } from "vitest";

import type { RoadDecorationBounds } from "../src/render-common/road-decoration-clearance";
import { createRoadDecorationRoadIndex } from "../src/shared/settlement/road-decoration-road-index";

it("local free-placement queries reuse a road-revision index and retain long crossing edges", () => {
  const local = { start: { x: 10, z: 10 }, end: { x: 30, z: 10 } };
  const source = { revision: 1, segments: vi.fn(() => [local,
    ...Array.from({ length: 1000 }, (_, x) => ({ start: { x, z: 100 }, end: { x: x + .5, z: 100 } }))]) };
  const index = createRoadDecorationRoadIndex(source), box: RoadDecorationBounds = { min: [20, 0, 9], max: [21, 4, 11] };
  for (let hover = 0; hover < 1000; hover++) expect(index.near(box)).toEqual([{ ...local, tier: "dirt" }]);
  expect(source.segments).toHaveBeenCalledOnce(); expect(index.counters().rebuilds).toBe(1);
  source.revision++; source.segments.mockReturnValue([]);
  expect(index.near(box)).toEqual([]); expect(index.counters().rebuilds).toBe(2);
});
