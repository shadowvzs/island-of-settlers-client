import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { groundPath as GroundPath } from "../src/shared/settlement/settlement-paths";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import type { outdoorWorkPath as OutdoorWorkPath } from "../src/shared/settlement/settlement-worker-stock-paths";

vi.mock("../src/shared/settlement/settlement-paths", () => ({ groundPath: vi.fn() }));

let groundPath: typeof GroundPath;
let outdoorWorkPath: typeof OutdoorWorkPath;
// isolate:false shares the module cache: load the subject fresh so it sees this file's mocks,
// then drop the mocks and the mocked graph so later files of the worker get the real modules.
beforeAll(async () => {
  vi.resetModules();
  ({ groundPath } = await import("../src/shared/settlement/settlement-paths"));
  ({ outdoorWorkPath } = await import("../src/shared/settlement/settlement-worker-stock-paths"));
});
afterAll(() => {
  vi.doUnmock("../src/shared/settlement/settlement-paths");
  vi.resetModules();
});

it("does not repeat an impossible outdoor route, but retries after an obstacle or road changes", () => {
  const building = { uid: 1, workerApproach: { x: 10, z: 10 } } as SettlementBuilding;
  const context = { buildings: [building], navigationRevision: 0,
    options: { world: { buildRevision: 0 }, roads: { revision: 0 } } } as unknown as SettlementContext;
  const target = { x: 20, z: 20 }, search = vi.mocked(groundPath);
  search.mockReturnValue(null); search.mockClear();
  expect(outdoorWorkPath(context, building, target)).toBeNull();
  expect(outdoorWorkPath(context, building, target)).toBeNull();
  expect(search).toHaveBeenCalledTimes(1);
  context.options.world.buildRevision = 1;
  search.mockReturnValue([target]);
  expect(outdoorWorkPath(context, building, target)).toEqual([target]);
  expect(search).toHaveBeenCalledTimes(2);
});
