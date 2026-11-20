import { describe, expect, it } from "vitest";

import { harbourBerthCount, harbourPlacementReason } from "../src/shared/settlement/settlement-harbour-placement";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { createShipSea } from "./helpers/ship-motion-scenarios";

/** A coast with a headland: some harbour plots get a second berth, those beside the headland do not. */
const HEADLAND = { tip: 50, z0: 55, z1: 62 };
const ROWS = [20, 40, 50, 70, 74, 80];

describe("harbour placement preview: 1 or 2 berths (owner, 2026-10-15)", () => {
  it("shows the berths the finished harbour gets, by the fleet's own search, cached per plot", () => {
    const counts = ROWS.map(z => {
      const sea = createShipSea(120, HEADLAND);
      const draft = makeBuilding(sea.context, 39, 15, z, 0);
      if (harbourPlacementReason(sea.context, draft) !== null) return null;
      const preview = harbourBerthCount(sea.context, draft);
      expect(harbourBerthCount(sea.context, draft)).toBe(preview);
      // The same plot built and at level 3 (the second berth's level): what the fleet then finds.
      const built = sea.harbour(z);
      built.workshopUpgrade = { level: 2 };
      const fleet = createNavalFleet(sea.context, sea.sea);
      expect(preview).toBe(fleet.harbourBerths(built.uid).length);
      return preview;
    });
    expect(counts).toContain(1);
    expect(counts).toContain(2);
  }, 60000);

  it("has no badge for other buildings", () => {
    const sea = createShipSea();
    expect(harbourBerthCount(sea.context, makeBuilding(sea.context, 1, 15, 60, 0))).toBeNull();
  });
});
