import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ISLAND_CHOICE, formatIslandChoice, parseIslandChoice, readIslandChoice, toWorldOptions
} from "../src/app/map-generator/helpers";
import { START_SETTLERS } from "../src/shared/balance/population";
import { COLONY_RESOURCE_TIERS } from "../src/shared/world/colony-resource-tiers";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { PROP } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const options = { ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 128, seed: 42,
  erosionDroplets: 0, forest: 2, homeResources: false, rivers: 0, mountains: 0, mountainProfiles: false,
  oreCapacity: false };
const treeKinds = new Set<number>([PROP.broadleafTree, PROP.coniferTree, PROP.palmTree,
  PROP.birchTree, PROP.hardwoodTree, PROP.cedarTree, PROP.walnutTree, PROP.mahoganyTree]);

describe("explicit replacement-map resource presets", () => {
  it.each(COLONY_RESOURCE_TIERS)("round-trips colony $tier without changing rectangular dimensions", pair => {
    const choice = { ...DEFAULT_ISLAND_CHOICE, width: 64, height: 128, size: 64, colonyResourceTier: pair.tier };
    expect(parseIslandChoice(formatIslandChoice(choice))).toEqual(choice);
    expect(toWorldOptions(choice)).toMatchObject({ cellsX: 64, cellsZ: 128, colonyResourceTier: pair.tier });
    // Selecting home explicitly clears a stored colony selection instead of inheriting it.
    const home = readIslandChoice(new URLSearchParams("colonyTier=home"), choice);
    expect(home.colonyResourceTier).toBeUndefined();
    expect(toWorldOptions(home)).not.toHaveProperty("colonyResourceTier");
  });
  it("rejects invalid tier requests and keeps ordinary generation free of colony metadata", () => {
    expect(parseIslandChoice("colonyTier=5").colonyResourceTier).toBeUndefined();
    expect(parseIslandChoice("colonyTier=1.5").colonyResourceTier).toBeUndefined();
    const world = cachedWorld(options);
    expect(world.colonyResourceTier).toBeUndefined(); expect(world.scenario).toBeUndefined();
    const kinds = Array.from(world.props.types).filter(kind => treeKinds.has(kind));
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every(kind => kind === PROP.coniferTree || kind === PROP.palmTree)).toBe(true);
    expect(() => cachedWorld({ ...options, colonyResourceTier: 5 as never })).toThrow("Unknown colony resource preset");
  });
  it.each(COLONY_RESOURCE_TIERS)("generates only pair $tier and creates a finite authored colony draft", pair => {
    const baseline = cachedWorld(options);
    const world = cachedWorld({ ...options, colonyResourceTier: pair.tier });
    expect(world.cellsX).toBe(64); expect(world.cellsZ).toBe(128);
    expect(world.colonyResourceTier).toBe(pair.tier); expect(world.expeditionKind).toBe("colony");
    expect(world.scenario).toMatchObject({ kind: "colony", settlers: START_SETTLERS, stock: STARTER_STOCK });
    expect(world.scenario?.headquarters).toBeDefined();
    expect(world.scenario?.units).toEqual([]); expect(world.scenario?.buildings).toEqual([]);
    expect(world.scenario?.landing).toBeUndefined();
    const trees = Array.from(world.props.types).filter(kind => treeKinds.has(kind));
    expect(trees.length).toBeGreaterThan(0); expect(trees.every(kind => kind === pair.treeKind)).toBe(true);
    expect(world.props.count).toBe(baseline.props.count);
    expect(world.props.x).toEqual(baseline.props.x); expect(world.props.z).toEqual(baseline.props.z);
    expect(world.heights).toEqual(baseline.heights);
    for (const source of world.colonyStoneDeposits ?? []) {
      expect(source.material).toBe(pair.stone); expect(source.remaining).toBe(48);
      expect(baseline.props.types[source.sourceProp!]).toBe(PROP.largeRock);
    }
    expect(world.scenario?.stock).not.toBe(STARTER_STOCK);
  });
});
