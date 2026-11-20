import { categoriesOfKind, entriesOfKind, type EntryOfKind, soldierEntries } from "@shared/catalog";
import { BIRD_TUNING } from "@shared/catalog/tuning/birds";
import { BUTTERFLY_TUNING } from "@shared/catalog/tuning/butterflies";
import { FISH_TUNING } from "@shared/catalog/tuning/fish";
import { ROAD_PLANT_TUNING } from "@shared/catalog/tuning/plants";
import { WHALE_TUNING } from "@shared/catalog/tuning/whales";
import { describe, expect, it } from "vitest";

import { ROAD_PLANTS } from "../../island-of-settlers-shared/src/road-plant-catalog";

import { BIRD_SPECIES } from "../src/render-common/birds/bird-species";
import {
  BUILDING_CATEGORY_GROUPS, type BuildingCategoryId, buildingCategoryKey
} from "../src/render-common/buildings/building-menu-groups";
import { BUTTERFLY_SPECIES } from "../src/render-common/butterflies/butterfly-species";
import { CRITTER } from "../src/render-common/critters/critter-species";
import { FISH_SPECIES } from "../src/render-common/fish-schools/fish-species";
import { ADVENTURE_PROP } from "../src/render-common/props/adventure-prop-kinds";
import { COVER } from "../src/render-common/props/prop-mesh-layout";
import { WHALE_SHAPES, WHALE_SPECIES } from "../src/render-common/whales/whale-species";
import { SPECIES, SPECIES_PROFILES } from "../src/render-common/wildlife/wildlife-species";
import type { MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";
import { ORE, PROP } from "../src/shared/world/world-data";

/**
 * Owner 2026-11-11 (answer 31): the persisted numeric enums stay typed TS constants for hot code; this guard
 * keeps them 1:1 with the catalog codes (every member is an entry with the same key and code, and back).
 */
const codesOf = (entries: readonly { code?: number; key: string }[]) =>
  Object.fromEntries(entries.map(entry => [entry.key, entry.code]));
const propsOfLayer = (layer: string) => (["tree", "stone", "plant", "shell"] as const)
  .flatMap(kind => entriesOfKind(kind) as readonly EntryOfKind<typeof kind>[])
  .filter(entry => entry.prop.layer === layer);

describe("persisted numeric enums equal the catalog codes", () => {
  it("PROP bytes are the world props", () => expect(codesOf(propsOfLayer("worldProp"))).toEqual(PROP));
  it("COVER kinds are the cover plants and beach shells", () =>
    expect(codesOf(propsOfLayer("cover"))).toEqual(COVER));
  it("ADVENTURE_PROP kinds are the adventure props", () =>
    expect(codesOf(propsOfLayer("adventure"))).toEqual(ADVENTURE_PROP));
  it("ORE bytes (without none) are the mine zone deposits", () => {
    const { none, ...ores } = ORE;
    const deposits = entriesOfKind("deposit").filter(entry => entry.deposit.source === "mineZone");
    expect(none).toBe(0);
    expect(Object.fromEntries(deposits.map(entry => [entry.key.replace(/Ore$/, ""), entry.code]))).toEqual(ores);
  });
  it("wildlife SPECIES, CRITTER and WHALE_SPECIES indexes are the catalog species", () => {
    expect(codesOf(entriesOfKind("animal"))).toEqual(SPECIES);
    expect(codesOf(entriesOfKind("critter"))).toEqual(CRITTER);
    expect(codesOf(entriesOfKind("whale"))).toEqual(WHALE_SPECIES);
    expect(SPECIES_PROFILES.map(profile => profile.name))
      .toEqual(entriesOfKind("animal").map(entry => entry.key));
  });
  it("the MilitaryTroopType union names exactly the soldier entries (cavalry retired)", () => {
    const troops = ["shield", "heavy", "archer", "cavalry"] as const satisfies readonly MilitaryTroopType[];
    expect(soldierEntries().map(entry => entry.key)).toEqual(troops);
    expect(entriesOfKind("soldier").map(entry => entry.key)).toEqual(troops.slice(0, -1));
  });
  it("the BuildingCategoryId union names exactly the building panel tabs (catalog building categories)", () => {
    const tabs = ["materials", "settlement", "food-drink", "industry", "mines", "military"] as const satisfies
      readonly BuildingCategoryId[];
    expect(BUILDING_CATEGORY_GROUPS.map(group => group.id)).toEqual(tabs);
    expect(tabs.map(buildingCategoryKey)).toEqual(categoriesOfKind("building").map(category => category.id));
  });
  it("species and plant tuning tables are the catalog tuning sidecars in code / table order", () => {
    const keys = (kind: "bird" | "butterfly" | "fish" | "whale") => entriesOfKind(kind).map(entry => entry.key);
    expect(BIRD_SPECIES).toEqual(keys("bird").map(key => BIRD_TUNING[key]));
    expect(BUTTERFLY_SPECIES.map(({ markings, name, under, upper, ...tuning }) =>
      ({ ...tuning, under: { style: under.style }, upper: { style: upper.style } })))
      .toEqual(keys("butterfly").map(key => BUTTERFLY_TUNING[key]));
    expect(FISH_SPECIES.map(({ name, ...tuning }) => tuning)).toEqual(keys("fish").map(key => FISH_TUNING[key]));
    expect(WHALE_SHAPES).toEqual(keys("whale").map(key => WHALE_TUNING[key]));
    expect(ROAD_PLANTS.map(plant => plant.id)).toEqual(Object.keys(ROAD_PLANT_TUNING));
  });
});
