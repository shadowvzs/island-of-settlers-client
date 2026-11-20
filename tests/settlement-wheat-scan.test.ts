import { describe, expect, it } from "vitest";

import { createWheatScanRotation, WHEAT_SCAN_BANDS } from "../src/shared/settlement/settlement-wheat-scan";

const AREA = { maxX: 30, maxZ: 27, minX: 14, minZ: 12 };

describe("wheat sowing-plot scan (LOG-02)", () => {
  it("scans the whole area while plots are free, then one band per search while the farm waits", () => {
    const scan = createWheatScanRotation();
    expect(scan.rows(1, AREA)).toEqual({ maxZ: 27, minZ: 12 });
    expect(scan.finish(1, true)).toBe(false);
    expect(scan.rows(1, AREA)).toEqual({ maxZ: 27, minZ: 12 });
    // Nothing free: the next searches walk the four bands in turn and wrap around.
    expect(scan.finish(1, false)).toBe(false);
    const bands = Array.from({ length: WHEAT_SCAN_BANDS + 1 }, () => {
      const rows = scan.rows(1, AREA);
      scan.finish(1, false);
      return rows;
    });
    expect(bands).toEqual([{ maxZ: 15, minZ: 12 }, { maxZ: 19, minZ: 16 }, { maxZ: 23, minZ: 20 },
      { maxZ: 27, minZ: 24 }, { maxZ: 15, minZ: 12 }]);
    // Another farm keeps its own turn.
    expect(scan.rows(2, AREA)).toEqual({ maxZ: 27, minZ: 12 });
  });

  it("asks for a full rescan as soon as a band finds a plot, for the nearest batch", () => {
    const scan = createWheatScanRotation();
    scan.finish(1, false);
    expect(scan.rows(1, AREA)).toEqual({ maxZ: 15, minZ: 12 });
    expect(scan.finish(1, true)).toBe(true);
    expect(scan.rows(1, AREA)).toEqual({ maxZ: 27, minZ: 12 });
  });
});
