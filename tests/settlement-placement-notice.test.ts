import { describe, expect, it } from "vitest";

import { createPlacementNotice } from "../src/app/settlement/placement-notice";

const MINE = "No free surveyed deposit for Granite mine: send a Geologist to survey one first";
const select = (building: number | null, rotation = 0) => ({ building, road: null, rotation, survey: null });

describe("placement notice", () => {
  it("clears the previous building's notice when another building is picked", () => {
    const notice = createPlacementNotice();
    notice.isStale(select(10), "");
    notice.told(MINE);
    expect(notice.isStale(select(17), MINE)).toBe(true);
  });

  it("clears the notice when placement ends", () => {
    const notice = createPlacementNotice();
    notice.isStale(select(10), "");
    notice.told(MINE);
    expect(notice.isStale(select(null), MINE)).toBe(true);
  });

  it("clears the notice when a road or survey tool replaces the building", () => {
    const notice = createPlacementNotice();
    notice.isStale(select(10), "");
    notice.told(MINE);
    expect(notice.isStale({ building: null, road: "dirt", rotation: 0, survey: null }, MINE)).toBe(true);
  });

  it("keeps the notice while the same building is rotated", () => {
    const notice = createPlacementNotice();
    notice.isStale(select(10), "");
    notice.told(MINE);
    expect(notice.isStale(select(10, 1), MINE)).toBe(false);
  });

  it("keeps a newer message that replaced the notice, and forgets the old notice", () => {
    const notice = createPlacementNotice();
    notice.isStale(select(10), "");
    notice.told(MINE);
    expect(notice.isStale(select(null), "Geologist dispatched from storage.")).toBe(false);
    expect(notice.isStale(select(17), MINE)).toBe(false);
  });

  it("never clears a status that was not a placement notice", () => {
    const notice = createPlacementNotice();
    expect(notice.isStale(select(17), "Planned Woodcutter. Connect its road endpoint.")).toBe(false);
  });
});
