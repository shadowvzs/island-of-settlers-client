import { LEVEL_THRESHOLDS, MAX_PLAYER_LEVEL } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/app/settlement/player-session";
import { createPlayerProgress } from "../src/shared/progression/player-progress";

const now = () => Date.UTC(2026, 9, 18, 12);
describe("debug player level increment", () => {
  it("adds ten levels using the target XP threshold and persists the result", () => {
    const session = createPlayerSession({ seed: 7, now });
    expect(session.addDebugLevels()).toBe(11);
    expect(session.progress().experience).toBe(LEVEL_THRESHOLDS[10]);
    const restored = createPlayerSession({ initial: session.progress(), seed: 7, now });
    expect(restored.level()).toBe(11);
    expect(restored.addDebugLevels()).toBe(21);
  });
  it("caps at the final level and repeated clicks do not award more XP or rewards", () => {
    const initial = { ...createPlayerProgress(7), experience: LEVEL_THRESHOLDS[MAX_PLAYER_LEVEL - 6]! };
    const session = createPlayerSession({ initial, seed: 7, now });
    expect(session.addDebugLevels()).toBe(MAX_PLAYER_LEVEL);
    const capped = structuredClone(session.progress());
    expect(session.addDebugLevels()).toBe(MAX_PLAYER_LEVEL);
    expect(session.progress()).toEqual(capped);
    expect(session.progress().experience).toBe(LEVEL_THRESHOLDS[MAX_PLAYER_LEVEL - 1]);
  });
});
