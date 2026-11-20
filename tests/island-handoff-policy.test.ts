import { describe, expect, it } from "vitest";

import {
  handoffFailureFallback,
  handoffFallback,
  type HandoffReadiness,
  handoffRefusal,
  handoffSavesDeparture,
  handoffWritesStartupPayload,
  IN_PAGE_HANDOFF_TRIGGERS
} from "../src/app/settlement/island-handoff-policy";

const ready = (overrides: Partial<HandoffReadiness> = {}): HandoffReadiness => ({
  authority: "browser",
  destinationMatches: true,
  prepared: true,
  trigger: "travel-home",
  ...overrides
});

describe("in-page island handoff gate", () => {
  it("enables travel, import, editor and graphics replacement triggers", () => {
    expect([...IN_PAGE_HANDOFF_TRIGGERS]).toEqual([
      "editor-generate", "editor-map-load", "generator-recreate", "graphics-detail",
      "graphics-reveal-ore", "import-game", "tab-resume", "travel-first-visit", "travel-home",
      "travel-saved-island"
    ]);
    for (const trigger of IN_PAGE_HANDOFF_TRIGGERS)
      expect(handoffRefusal(ready({ trigger }))).toBeNull();
  });

  it("refuses a changed or unknown account authority and a mismatched destination", () => {
    expect(handoffRefusal(ready({ authority: "account-current" }))).toBeNull();
    expect(handoffRefusal(ready({ authority: "account-changed" }))).toBe("authority-changed");
    expect(handoffRefusal(ready({ authority: "account-unknown" }))).toBe("authority-unknown");
    expect(handoffRefusal(ready({ destinationMatches: false }))).toBe("destination-changed");
    expect(handoffFallback("authority-changed")).toBe("reload");
    expect(handoffFallback("authority-unknown")).toBe("reload");
    expect(handoffFallback("destination-changed")).toBe("reload");
  });

  it("resumes the old island when destination preparation did not finish", () => {
    expect(handoffRefusal(ready({ prepared: false }))).toBe("not-prepared");
    expect(handoffFallback("not-prepared")).toBe("resume-old");
  });

  it("never resumes the departing island after the destination save is committed", () => {
    expect(handoffFailureFallback(false)).toBe("resume-old");
    expect(handoffFailureFallback(true)).toBe("reload");
  });

  it("separates a departure save from a new map and a startup fallback payload", () => {
    expect(handoffSavesDeparture("travel-home")).toBe(true);
    expect(handoffSavesDeparture("travel-saved-island")).toBe(true);
    expect(handoffSavesDeparture("travel-first-visit")).toBe(true);
    // Ending/disbanding the active island is not a save-before-leave: its survivors/rewards are
    // already in the destination payload and the island is deliberately removed.
    expect(handoffSavesDeparture("travel-home", true)).toBe(false);
    expect(handoffSavesDeparture("travel-saved-island", true)).toBe(false);
    expect(handoffSavesDeparture("import-game")).toBe(false);
    expect(handoffSavesDeparture("generator-recreate")).toBe(false);
    expect(handoffSavesDeparture("editor-generate")).toBe(false);
    expect(handoffSavesDeparture("editor-map-load")).toBe(false);

    expect(handoffWritesStartupPayload("travel-first-visit")).toBe(true);
    expect(handoffWritesStartupPayload("import-game")).toBe(true);
    expect(handoffWritesStartupPayload("travel-home")).toBe(false);
    expect(handoffWritesStartupPayload("travel-saved-island")).toBe(false);
    expect(handoffWritesStartupPayload("generator-recreate")).toBe(false);
    expect(handoffWritesStartupPayload("editor-map-load")).toBe(false);
  });
});
