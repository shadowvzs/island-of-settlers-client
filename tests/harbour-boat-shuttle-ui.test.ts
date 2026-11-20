import { describe, expect, it } from "vitest";

import { getHarbourShuttleText } from "../src/app/settlement-ui/building-details/harbour-helpers";
import type { ShuttleStatus } from "../src/shared/settlement/harbour-shuttle-plan";

const status = (patch: Partial<ShuttleStatus>): ShuttleStatus => ({
  freeBoats: 1, idleRowers: 4, reason: "idle", storedBoats: 1, uid: 1, ...patch
});

describe("harbour boat shuttle text", () => {
  it("states actual counts and every unavailable reason", () => {
    expect(getHarbourShuttleText(status({ reason: "idle" }))).toContain("1 available boat");
    expect(getHarbourShuttleText(status({ reason: "idle" }))).toContain("4 idle rower");
    expect(getHarbourShuttleText(status({ reason: "no-landing" }))).toContain("no safe dedicated boat landing");
    expect(getHarbourShuttleText(status({ reason: "no-partner" }))).toContain("no nearby completed harbour");
    expect(getHarbourShuttleText(status({ reason: "no-route" }))).toContain("1.5× fishery range");
    expect(getHarbourShuttleText(status({ reason: "no-crew" }))).toContain("two idle rowers");
    expect(getHarbourShuttleText(status({ reason: "waiting-boat" }))).toContain("stored boat");
    expect(getHarbourShuttleText(status({ reason: "route-blocked" }))).toContain("water route blocked");
    expect(getHarbourShuttleText(status({ cargo: { stone: 2 }, reason: "cargo-blocked" })))
      .toContain("no safe port");
  });
  it("shows the actual cargo and remaining seconds of an active job", () => {
    const text = getHarbourShuttleText(status({ cargo: { stone: 3 }, destinationUid: 2, phase: "outbound",
      reason: "active", secondsLeft: 12.2 }));
    expect(text).toContain("harbour 2");
    expect(text).toContain("3");
    expect(text).toContain("13s");
  });
});
