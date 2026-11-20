import { afterEach, describe, expect, it, vi } from "vitest";

import { settingsStorage } from "../src/app/settings/graphics-settings";
import { createVertexFog } from "../src/render-common/chunk-sampling";
import { createLiveFog } from "../src/render-common/live-fog";
import { createGameSave, readGameSave } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { unpackFog } from "../src/shared/settlement/save-cell-codecs";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { displayFogAt, setFogDisplay } from "../src/shared/world/fog-display";
import { FOG, type WorldData } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

afterEach(() => vi.unstubAllGlobals());

describe("reversible fog presentation", () => {
  it("remembers the historical setting without a reload and tolerates blocked storage", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value) });
    expect(settingsStorage.readFog()).toBe(true);
    settingsStorage.writeFog(false);
    expect(values.get("island-of-settlers.fog-of-war")).toBe("0");
    expect(settingsStorage.readFog()).toBe(false);
    settingsStorage.writeFog(true); expect(settingsStorage.readFog()).toBe(true);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); } });
    expect(settingsStorage.readFog()).toBe(true);
    expect(() => settingsStorage.writeFog(false)).not.toThrow();
  });

  it("changes GPU and presentation samples while preserving exploration and live exploration updates", () => {
    const world = { cellsX: 2, cellsZ: 2, fog: new Uint8Array([0, 1, 2, 0]),
      permanentFog: new Uint8Array([0, 1, 2, 0]), fogRevision: 0 } as WorldData;
    const original = world.fog.slice(), permanent = world.permanentFog!.slice();
    const live = createLiveFog(world);
    setFogDisplay(world, false);
    expect(live.update()).toBe(true);
    expect(createVertexFog(world).every(value => value === 1)).toBe(true);
    expect(live.pixels.every(value => value === 255)).toBe(true);
    expect(displayFogAt(world, 0)).toBe(FOG.visible);
    expect(world.fog).toEqual(original); expect(world.permanentFog).toEqual(permanent);
    // Normal vision keeps recording discoveries while the presentation is revealed.
    world.fog[0] = FOG.discovered; world.fogRevision!++;
    setFogDisplay(world, true); expect(live.update()).toBe(true);
    expect(displayFogAt(world, 0)).toBe(FOG.discovered);
    expect(displayFogAt(world, 3)).toBe(FOG.hidden);
    expect(world.permanentFog).toEqual(permanent);
    const revision = world.fogRevision;
    setFogDisplay(world, true); expect(world.fogRevision).toBe(revision);
  });

  const RIVERLESS_WORLD = { ...SMALL_EDITOR_WORLD, rivers: 0 };
  preloadWorlds(RIVERLESS_WORLD);
  it("saves real exploration without serializing the presentation override", async () => {
    const world = cachedWorld(RIVERLESS_WORLD);
    const roads = createRoadNetwork(world), simulation = createSettlementSimulation({ world, roads });
    const hidden = world.fog.findIndex(value => value === FOG.hidden);
    expect(hidden).toBeGreaterThanOrEqual(0);
    const exploration = world.fog.slice();
    setFogDisplay(world, false);
    const saved = await createGameSave(world, simulation.saveState(), {
      name: "Fog presentation save", source: "generated", savedAt: 1, animals: []
    });
    expect(unpackFog(saved.progress.fog, exploration.length)).toEqual(exploration);
    expect(exploration[hidden]).toBe(FOG.hidden);
    const loaded = await readGameSave(saved);
    expect(loaded.map.world.fogDisplayDisabled).toBeUndefined();
    expect(loaded.map.world.fog[hidden]).toBe(FOG.hidden);
    expect(world.fog).toEqual(exploration);
  });
});
