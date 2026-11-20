import type { Page } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { connectBuildingUi } from "../tools/e2e/full/natural-ui-helpers";

const start = { x: 1, z: 1 }, end = { x: 4, z: 1 };

/** Execute the driver's real browser callbacks against the real road graph, with only UI transport stubbed. */
const setup = (preexisting: boolean, reject = false, unrelatedRevision = false) => {
  const roads = createRoadNetwork({ cellsX: 8, cellsZ: 8,
    heights: new Float32Array(81), blocking: new Uint8Array(64) });
  if (preexisting) roads.addRoad(start, end);
  let clicks = 0, accepted = false;
  const success = {
    filter: () => success,
    first: () => success,
    waitFor: async () => { if (!accepted) throw new Error("Dirt road success status missing"); }
  };
  const button = { click: async () => {}, isVisible: async () => false };
  const page = {
    evaluate: async (action: (arg: unknown) => unknown, arg: unknown) => action(arg),
    getByRole: (role: string) => role === "status" ? success : button,
    keyboard: { press: async () => {} },
    mouse: {
      move: async () => {},
      click: async () => {
        clicks++;
        if (clicks !== 2) return;
        if (reject) return;
        accepted = true;
        if (unrelatedRevision) { roads.addRoad({ x: 1, z: 5 }, { x: 4, z: 5 }); return; }
        accepted = roads.addRoad(start, end);
      }
    },
    viewportSize: () => ({ width: 1440, height: 960 }),
    waitForFunction: async (action: (arg: unknown) => boolean, arg: unknown) => {
      if (!action(arg)) throw new Error("No committed route between requested endpoints");
    }
  };
  vi.stubGlobal("window", { __settlement: {
    projectGround: (x: number, z: number) => ({ x: x * 10, y: z * 10 }), roads,
    simulation: {
      buildings: () => [{ uid: 0, typeId: 0, access: start }, { uid: 1, typeId: 17, access: end }],
      planRoad: roads.planRoad, roadRevision: () => roads.revision
    }
  } });
  return { page: page as unknown as Page, roads };
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("natural E2E road connection proof", () => {
  it("accepts an idempotent UI connection backed by an existing real route", async () => {
    const { page, roads } = setup(true);
    const revision = roads.revision;
    const evidence = await connectBuildingUi(page, 1);
    expect(evidence).toMatchObject({ preexisting: true, revision, finalRevision: revision, routeLength: 3 });
    expect(evidence.routePoints).toBeGreaterThan(1);
  });

  it("proves a newly built route and records its changed revision", async () => {
    const { page } = setup(false);
    expect(await connectBuildingUi(page, 1)).toMatchObject({
      preexisting: false, revision: 0, finalRevision: 1, routeLength: 3
    });
  });

  it("rejects a disconnected target even when an unrelated road changed revision", async () => {
    const { page } = setup(false, false, true);
    await expect(connectBuildingUi(page, 1)).rejects.toThrow("No committed route");
  });

  it("requires successful UI feedback even if the endpoints were already connected", async () => {
    const { page } = setup(true, true);
    await expect(connectBuildingUi(page, 1)).rejects.toThrow("success status missing");
  });
});
