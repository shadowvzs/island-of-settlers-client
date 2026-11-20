import { describe, expect, it } from "vitest";

import { getDialogueSpeedChoices } from "../src/app/settings/dialogue-speed/helpers";
import {
  createDialogueSpeedPreference, dialogueMsPerChar, parseDialogueSpeed
} from "../src/app/settings/dialogue-speed/preference";

describe("dialogue speed setting", () => {
  it("reads a stored choice, defaults to Normal and maps to 75 / 60 / 45 ms per character", () => {
    expect(parseDialogueSpeed("slow")).toBe("slow");
    expect(parseDialogueSpeed(null)).toBe("normal");
    expect(parseDialogueSpeed("warp")).toBe("normal");
    expect(["slow", "normal", "fast"].map(speed => dialogueMsPerChar(parseDialogueSpeed(speed)))).toEqual([75, 60, 45]);
  });

  it("persists and publishes only real changes", () => {
    const writes: string[] = [];
    const preference = createDialogueSpeedPreference("fast", value => writes.push(value));
    let published = 0;
    preference.subscribe(() => published++);
    preference.setSpeed("fast");
    preference.setSpeed("slow");
    expect(preference.getSnapshot()).toBe("slow");
    expect(writes).toEqual(["slow"]);
    expect(published).toBe(1);
  });

  it("offers the choices slowest first", () => {
    expect(getDialogueSpeedChoices().map(choice => choice.label)).toEqual(["Slow", "Normal", "Fast"]);
  });
});
