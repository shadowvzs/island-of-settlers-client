import { describe, expect, it } from "vitest";

import { A14_SEED_OFFSETS } from "../tools/bench/military-a14-scenarios";
import { a14Off, a14Run } from "./helpers/a14-fixtures";

/** A14-3 retreat + rally gates (plan §10.1, §11); lane gates run once `A14-3` is in `A14_LANES_ON`. */
const ROUTED_STALL_LIMIT_SECONDS = 3;

describe("A14-3 retreat and rally", () => {
  it("outnumbered rout: no soldier stalls longer than 3 s", () => {
    expect(a14Run("outnumberedRout").longestStallSeconds).toBeLessThanOrEqual(ROUTED_STALL_LIMIT_SECONDS);
  }, 120_000);

  it.skipIf(a14Off("A14-3"))("outnumbered rout: on every seed the routes' enemy influence is below the straight line's",
    () => {
      for (const offset of A14_SEED_OFFSETS) {
        const metrics = a14Run("outnumberedRout", offset);
        // `retreatPathExposure`: summed enemy influence on the chosen routes over the straight lines' (< 1).
        expect(metrics.retreatPathExposure, `seed offset ${offset}`).not.toBeNull();
        expect(metrics.retreatPathExposure!, `seed offset ${offset}`).toBeLessThan(1);
      }
    }, 600_000);

  it.skipIf(a14Off("A14-3"))("outnumbered rout: no routed soldier stalls longer than 3 s on any seed", () => {
    for (const offset of A14_SEED_OFFSETS) {
      const metrics = a14Run("outnumberedRout", offset);
      expect(metrics.routCount, `seed offset ${offset}`).toBeGreaterThan(0);
      expect(metrics.routedStallSeconds, `seed offset ${offset}`).toBeLessThanOrEqual(ROUTED_STALL_LIMIT_SECONDS);
    }
  }, 600_000);

  it.skipIf(a14Off("A14-3"))("aura rally: routed soldiers rally within the fixture", () => {
    const metrics = a14Run("auraRally");
    expect(metrics.timeToRallySeconds).not.toBeNull();
  }, 120_000);
});
