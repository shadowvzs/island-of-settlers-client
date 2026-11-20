import { describe, expect, it } from "vitest";

import {
  createIslandFormDraft, DEFAULT_ISLAND_CHOICE, getIslandFormState, readIslandChoice, toWorldOptions, updateIslandDraft
} from "../src/app/map-generator/helpers";
import { harbourSpotCount } from "../src/shared/settlement/generated-harbour-spots";
import { harbourSpotAt, storedHarbourSpots } from "../src/shared/settlement/harbour-spot-index";
import { harbourPlacementReason } from "../src/shared/settlement/settlement-harbour-placement";
import { createScenarioInspectionContext } from "../src/shared/settlement/settlement-map-scenario";
import { createNavalExpeditions } from "../src/shared/settlement/settlement-naval-expeditions";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { createSeaMask } from "../src/shared/settlement/settlement-sea-navigation";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../src/shared/world/generation/generate-world";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";

const generate = (query: string, seed = 1234) => generateWorld({ ...DEFAULT_WORLD_OPTIONS,
  ...toWorldOptions(readIslandChoice(new URLSearchParams(query), DEFAULT_ISLAND_CHOICE)), seed });

describe("harbour spots generator option (HARBOUR-SPOTS)", () => {
  it("is offered and applied only with more than one island", () => {
    const one = readIslandChoice(new URLSearchParams("landform=archipelago&islandCount=1&harbourSpots=1"),
      DEFAULT_ISLAND_CHOICE);
    const two = readIslandChoice(new URLSearchParams("landform=archipelago&islandCount=2&harbourSpots=1"),
      DEFAULT_ISLAND_CHOICE);
    expect(toWorldOptions(one).harbourSpots).toBeUndefined();
    expect(toWorldOptions(two).harbourSpots).toBe(true);
    expect(getIslandFormState(createIslandFormDraft(one)).showHarbourSpots).toBe(false);
    const draft = updateIslandDraft(createIslandFormDraft(two), {});
    expect(getIslandFormState(draft)).toMatchObject({ harbourSpots: true, showHarbourSpots: true });
  });
});

describe("generated harbour spots", () => {
  const query = "size=256&landform=archipelago&islandCount=2&harbourSpots=1";
  const world = generate(query);
  const sites = world.playableIslands!.sites;

  it("scales the spot count with the island size", () => {
    expect([30, 89, 90, 139, 140, 199].map(harbourSpotCount)).toEqual([2, 2, 3, 3, 4, 4]);
  });

  it("stores the size-scaled number of spread, deterministic spots per island", () => {
    for (const site of sites) {
      expect(site.harbourSpots!.length).toBe(harbourSpotCount(site.radius));
      const spots = site.harbourSpots!;
      for (let a = 0; a < spots.length; a++) for (let b = a + 1; b < spots.length; b++)
        expect(Math.hypot(spots[a]!.x - spots[b]!.x, spots[a]!.z - spots[b]!.z)).toBeGreaterThanOrEqual(28);
    }
    expect(generate(query).playableIslands!.sites.map(site => site.harbourSpots))
      .toEqual(sites.map(site => site.harbourSpots));
  }, 60_000);

  it("pre-levels each plot and passes the native harbour and landing rules", () => {
    const context = createScenarioInspectionContext(world);
    const { site } = createNavalExpeditions(context, createSeaMask(world));
    for (const spot of storedHarbourSpots(world)) {
      const plot = makeBuilding(context, 39, spot.x, spot.z, spot.rotation);
      for (let z = plot.z - 3; z <= plot.z + 3; z++) for (let x = plot.x - 3; x <= plot.x + 3; x++)
        expect(world.heights[z * (world.cellsX + 1) + x]).toBe(Math.fround(plot.y));
      expect(harbourPlacementReason(context, plot)).toBeNull();
      expect(site(spot)).not.toBeNull();
      expect(harbourSpotAt(world, spot.x, spot.z, spot.rotation)).toBe(spot);
    }
  }, 60_000);

  it("survives a map file round trip", async () => {
    const bytes = await writeMapFile(world, { animals: [], name: "Spots", savedAt: 1, source: "legacy" });
    const loaded = (await readMapFile(bytes)).world;
    expect(loaded.playableIslands!.sites.map(site => site.harbourSpots))
      .toEqual(sites.map(site => site.harbourSpots));
  }, 60_000);

  it("stores nothing when the option is off", () => {
    const plain = generate("size=256&landform=archipelago&islandCount=2");
    expect(storedHarbourSpots(plain)).toHaveLength(0);
  }, 60_000);
});
