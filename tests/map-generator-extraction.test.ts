import { afterEach, describe, expect, it, vi } from "vitest";

import { getInitialIslandChoice, reloadWithNewIsland } from "../src/app/map-generator/actions";
import { createIslandDraft, DEFAULT_ISLAND_CHOICE, formatIslandChoice,
  replacementIslandChoice } from "../src/app/map-generator/helpers";
import { generatorStorage } from "../src/app/map-generator/storage";
import * as legacyActions from "../src/app/settings/graphics-settings";

const setup = (search = "", stored = "") => {
  const values = new Map([["island-of-settlers.island", stored]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) });
  const location = { search, pathname: "/settlers/", href: "unchanged" };
  vi.stubGlobal("location", location);
  return { location, values };
};
afterEach(() => vi.unstubAllGlobals());

describe("feature-owned map generator extraction", () => {
  it("keeps one canonical implementation behind existing settings entry points", () => {
    expect(legacyActions.settingsStorage.readIsland).toBe(generatorStorage.read);
    expect(legacyActions.settingsStorage.writeIsland).toBe(generatorStorage.write);
  });
  it("keeps legacy single-island normalization and independent dimension drafts without mutating input", () => {
    const initial = { ...DEFAULT_ISLAND_CHOICE, landform: "island" as const, size: 64, width: 64, height: 128 };
    const before = structuredClone(initial), draft = createIslandDraft(initial);
    expect(draft).toMatchObject({ landform: "archipelago", islandCount: 1, width: 64, height: 128 });
    draft.forest = 4;
    expect(initial).toEqual(before);
  });
  it("retains stored/query precedence and rectangle serialization; only the URL carries a colony tier", () => {
    const stored = formatIslandChoice({ ...DEFAULT_ISLAND_CHOICE, forest: 4, colonyResourceTier: 3,
      width: 128, height: 256, size: 128 });
    setup("?width=64&height=128&forest=0", stored);
    const choice = getInitialIslandChoice();
    expect(choice).toMatchObject({ width: 64, height: 128, forest: 0 });
    expect(choice).not.toHaveProperty("colonyResourceTier");
    setup("?colonyTier=3", stored);
    expect(getInitialIslandChoice()).toMatchObject({ forest: 4, colonyResourceTier: 3 });
  });
  it("generates exactly through the existing reload boundary and preserves unrelated settings", () => {
    const { location, values } = setup("?map=old&view=1,2,3&quality=minimal&debug=1");
    const choice = { ...DEFAULT_ISLAND_CHOICE, width: 64, height: 128, size: 64, colonyResourceTier: 2 as const };
    reloadWithNewIsland(choice, 4294967295);
    const query = new URL(location.href, "https://example.test").searchParams;
    expect(query.get("seed")).toBe("4294967295");
    expect(query.get("width")).toBe("64"); expect(query.get("height")).toBe("128");
    expect(query.get("colonyTier")).toBe("2"); expect(query.get("quality")).toBe("minimal");
    expect(query.get("debug")).toBe("1"); expect(query.has("map")).toBe(false); expect(query.has("view")).toBe(false);
    // The stored preference stays a home island: a later plain game never opens a colony draft.
    expect(values.get("island-of-settlers.island")).toBe(formatIslandChoice({ ...choice, colonyResourceTier: undefined }));
  });
  it("refuses invalid seeds before persistence/navigation and tolerates blocked preference storage", () => {
    const { location, values } = setup();
    for (const seed of [-1, .5, Infinity, 4294967296])
      expect(() => reloadWithNewIsland(DEFAULT_ISLAND_CHOICE, seed)).toThrow(RangeError);
    expect(location.href).toBe("unchanged"); expect(values.get("island-of-settlers.island")).toBe("");
    vi.stubGlobal("localStorage", { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } });
    expect(generatorStorage.read()).toEqual(DEFAULT_ISLAND_CHOICE);
    reloadWithNewIsland(DEFAULT_ISLAND_CHOICE, 7);
    expect(new URL(location.href, "https://example.test").searchParams.get("seed")).toBe("7");
  });
  it("prepares replacement options without changing the current world's resources or history", () => {
    const world = { cellsX: 64, cellsZ: 128, seed: 19, colonyResourceTier: 1, props: { types: [1, 2] }, history: ["old"] };
    const before = structuredClone(world);
    expect(replacementIslandChoice(DEFAULT_ISLAND_CHOICE, world, 4)).toMatchObject({ width: 64, height: 128,
      size: 64, colonyResourceTier: 4 });
    expect(world).toEqual(before);
  });
  it("persists terrain variation through storage, URL override and the recreate boundary", () => {
    const stored = formatIslandChoice({ ...DEFAULT_ISLAND_CHOICE, terrainVariation: 4 });
    const { location, values } = setup("?terrainVariation=0", stored);
    expect(getInitialIslandChoice().terrainVariation).toBe(0);
    reloadWithNewIsland({ ...getInitialIslandChoice(), terrainVariation: 1 }, 9);
    expect(new URL(location.href, "https://example.test").searchParams.get("terrainVariation")).toBe("1");
    expect(values.get("island-of-settlers.island")).toContain("terrainVariation=1");
  });
});
