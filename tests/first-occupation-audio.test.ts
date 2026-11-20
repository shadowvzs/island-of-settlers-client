import { expect, it, vi } from "vitest";

import { createFirstOccupationObserver, type OccupationSite,occupationTrumpetGain } from "../src/app/audio/first-occupation";

const site = (uid = 1, typeId = 16): OccupationSite => ({ uid, typeId, construction: 1, militaryFaction: 0, territoryClaimed: false });

it("releases demolished identities and scopes loaded first-occupation receipts to each island observer", () => {
  const play = vi.fn(), first = { ...site(), territoryClaimed: true };
  const observe = createFirstOccupationObserver([first], play);
  observe([first]); observe([]);
  const replacement = site(first.uid);
  observe([replacement]); replacement.territoryClaimed = true; observe([replacement]);
  expect(play).toHaveBeenCalledTimes(1);
  observe.dispose();
  // Island travel/load constructs a new observer with its complete already-claimed collection.
  createFirstOccupationObserver(JSON.parse(JSON.stringify([replacement])), play)([replacement]);
  expect(play).toHaveBeenCalledTimes(1);
});

it("uses the persisted first-occupation receipt once per building despite staffing changes and JSON reload", () => {
  const fort = site(), play = vi.fn(), observe = createFirstOccupationObserver([fort], play);
  observe([fort]); expect(play).not.toHaveBeenCalled();
  fort.territoryClaimed = true; observe([fort]); expect(play).toHaveBeenCalledTimes(1);
  observe([fort]); observe([fort]); expect(play).toHaveBeenCalledTimes(1);
  const saved = JSON.parse(JSON.stringify([fort]));
  createFirstOccupationObserver(saved, play)(saved); expect(play).toHaveBeenCalledTimes(1);
  const captured = { ...fort, militaryFaction: 1 };
  const reloaded = createFirstOccupationObserver(JSON.parse(JSON.stringify([captured])), play);
  reloaded([{ ...captured, militaryFaction: 0 }]); expect(play).toHaveBeenCalledTimes(1);
  const next = { ...site(2, 4), territoryClaimed: true };
  observe([fort, next]); expect(play).toHaveBeenCalledTimes(2);
});

it("ignores enemy occupation, headquarters and unfinished buildings", () => {
  const play = vi.fn(), observe = createFirstOccupationObserver([], play);
  const enemy = { ...site(), territoryClaimed: true, militaryFaction: 1 };
  observe([enemy, { ...site(2, 0), territoryClaimed: true }, { ...site(3), territoryClaimed: true, construction: .9 }]);
  expect(play).not.toHaveBeenCalled();
  observe([{ ...enemy, militaryFaction: 0 }]); expect(play).toHaveBeenCalledTimes(1);
});

it("uses existing SFX/master gain and consumes muted occupation events without a later replay", () => {
  let enabled = false;
  const audible = vi.fn(), fort = site();
  const observe = createFirstOccupationObserver([fort], () => {
    if (occupationTrumpetGain(enabled, .8, .5) > 0) audible();
  });
  fort.territoryClaimed = true; observe([fort]); enabled = true; observe([fort]);
  expect(audible).not.toHaveBeenCalled();
  expect(occupationTrumpetGain(true, .8, .5)).toBeCloseTo(.14);
  expect(occupationTrumpetGain(false, 1, 1)).toBe(0);
  expect(occupationTrumpetGain(true, 0, 1)).toBe(0);
  expect(occupationTrumpetGain(true, 1, 0)).toBe(0);
});

it("applies live SFX mute to the actual audio wrapper without replaying on unmute or reload", async () => {
  const { settingsStorage } = await import("../src/app/settings/graphics-settings");
  const { audioLevels } = await import("../src/app/audio/audio-levels");
  const { createMilitaryOccupationAudio } = await import("../src/app/audio/military-occupation-audio");
  const play = vi.fn(async () => {}), pause = vi.fn();
  const voices: { volume: number; currentTime: number; src: string }[] = [];
  vi.stubGlobal("Audio", class {
    volume = 1; currentTime = 0; src: string;
    play = play; pause = pause;
    constructor(src: string) { this.src = src; voices.push(this); }
  });
  let enabled = true;
  vi.spyOn(settingsStorage, "readSound").mockImplementation(() => enabled);
  vi.spyOn(settingsStorage, "readEnvironmentVolume").mockReturnValue(.5);
  vi.spyOn(audioLevels, "getSnapshot").mockReturnValue({ master: .8, music: 1 });
  const fort = site(), audio = createMilitaryOccupationAudio([fort]);
  fort.territoryClaimed = true; audio.update([fort]);
  expect(play).toHaveBeenCalledTimes(1); expect(voices[0]!.volume).toBeCloseTo(.14);
  enabled = false; audio.update([fort]); expect(voices[0]!.volume).toBe(0); expect(pause).toHaveBeenCalled();
  enabled = true; audio.update([fort]); expect(play).toHaveBeenCalledTimes(1);
  const loaded = createMilitaryOccupationAudio(JSON.parse(JSON.stringify([fort])));
  loaded.update([fort]); expect(play).toHaveBeenCalledTimes(1);
  loaded.dispose(); audio.dispose(); expect(voices[0]!.src).toBe("");
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
