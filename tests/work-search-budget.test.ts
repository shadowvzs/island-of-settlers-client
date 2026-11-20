import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { findWorkTarget as FindWorkTarget } from "../src/shared/settlement/settlement-resources";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import type { outdoorWorkPath as OutdoorWorkPath } from "../src/shared/settlement/settlement-worker-stock-paths";

vi.mock("../src/shared/settlement/settlement-worker-stock-paths", () => ({ outdoorWorkPath: vi.fn() }));

let findWorkTarget: typeof FindWorkTarget;
let outdoorWorkPath: typeof OutdoorWorkPath;
// isolate:false shares the module cache: load the subject fresh so it sees this file's mocks,
// then drop the mocks and the mocked graph so later files of the worker get the real modules.
beforeAll(async () => {
  vi.resetModules();
  ({ findWorkTarget } = await import("../src/shared/settlement/settlement-resources"));
  ({ outdoorWorkPath } = await import("../src/shared/settlement/settlement-worker-stock-paths"));
});
afterAll(() => {
  vi.doUnmock("../src/shared/settlement/settlement-worker-stock-paths");
  vi.resetModules();
});

it("bounds failed work route searches and eventually reaches a later accessible resource", () => {
  const building = { uid: 1, x: 10, z: 10 } as SettlementBuilding;
  const context = { buildings: [building], options: {
    world: { buildRevision: 1 }, resourceTargets: () => [
      { id: 1, kind: "wildlife", x: 12, z: 10 }, { id: 2, kind: "wildlife", x: 18, z: 10 }
    ] }, reservations: new Set(), resourceAmounts: new Map() } as unknown as SettlementContext;
  const route = vi.mocked(outdoorWorkPath);
  route.mockImplementation((_context, _building, approach) => approach.x === 14 && approach.z === 10 ? [approach] : null);
  let found: ReturnType<typeof findWorkTarget> = null;
  for (let retry = 0; retry < 10 && !found; retry++) {
    route.mockClear(); found = findWorkTarget(context, building, "wildlife");
    expect(route.mock.calls.length).toBeLessThanOrEqual(2);
  }
  expect(found?.target.id).toBe(2);
});
