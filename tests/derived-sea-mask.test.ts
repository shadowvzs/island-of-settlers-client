import { expect, it } from "vitest";

import { registerDerivedSeaMask } from "../src/shared/settlement/settlement-sea-navigation";
import { createShipRoutePlanner } from "../src/shared/settlement/settlement-ship-routes";
import type { WorldData } from "../src/shared/world/world-data";

/**
 * The relief departure sea (settlement-relief-departure.ts) is a derived geometry with only dimensions and a
 * mask: its route planner must not record terrain heights for it (JETTY-FRAMES source tracking threw on it,
 * so a loaded relief ship could never sail off the map).
 */
it("plans routes on a derived sea geometry that carries no terrain heights", () => {
  const geometry = { cellsX: 24, cellsZ: 24, terrainRevision: 0 } as WorldData;
  const sea = new Uint8Array(24 * 24).fill(1);
  registerDerivedSeaMask(geometry, sea);
  expect(() => createShipRoutePlanner(geometry, sea)).not.toThrow();
});
