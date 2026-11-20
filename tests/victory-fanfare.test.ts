import { describe, expect, it } from "vitest";

import { fanfareLength, VICTORY_FANFARE, VICTORY_TIMPANI } from "../src/app/audio/victory-fanfare";

describe("victory fanfare", () => {
  it("lasts about three seconds: long enough to celebrate, short enough not to drag", () => {
    const length = fanfareLength(VICTORY_FANFARE);
    expect(length).toBeGreaterThanOrEqual(2.5);
    expect(length).toBeLessThanOrEqual(3.5);
    expect(Math.max(...VICTORY_TIMPANI)).toBeLessThan(length);
  });

  it("keeps the lead in the trumpet range and ends on a held chord", () => {
    const leads = VICTORY_FANFARE.filter(note => note.voice === "lead");
    for (const note of leads) expect(note.frequency).toBeGreaterThan(180);
    for (const note of leads) expect(note.frequency).toBeLessThan(1050);
    const finalStart = Math.max(...VICTORY_FANFARE.map(note => note.at));
    expect(VICTORY_FANFARE.filter(note => note.at === finalStart).length).toBeGreaterThanOrEqual(3);
  });
});
