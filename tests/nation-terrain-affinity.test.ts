import { describe, expect, it } from "vitest";

import { NATIONS } from "../../island-of-settlers-shared/src/nations";
import { MAP_EDITOR_MESSAGES as M } from "../src/app/map-editor/messages";
import { COVER } from "../src/render-common/props/prop-mesh-layout";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { displayNationName } from "../src/shared/i18n/domain";
import { translateMessage } from "../src/shared/i18n/translate";
import {
  coverKindAssociations, favoredCoverKinds, getNationTerrainAffinity, getWorldNationAffinity,
  nationsTypicalOfCover, nationsTypicalOfGround, nationsTypicalOfPalette, nationsTypicalOfVariant
} from "../src/shared/world/nation-terrain-affinity";

describe("nation terrain affinity table", () => {
  it("gives every playable nation a homeland landscape", () => {
    for (const nation of NATIONS) expect(getNationTerrainAffinity(nation), nation).toBeDefined();
  });

  it("lists the nations typical of a ground tile", () => {
    expect(nationsTypicalOfGround("sand")).toEqual(["nubian", "indigenous", "persian"]);
    expect(nationsTypicalOfGround("forestFloor")).toEqual(["viking", "japanese", "maya"]);
    expect(nationsTypicalOfGround("mineGravel")).toEqual([]);
  });

  it("lists the nations typical of a ground variant", () => {
    expect(nationsTypicalOfVariant("cracked-earth")).toEqual(["nubian", "persian"]);
    expect(nationsTypicalOfVariant("tilled-soil")).toEqual(["chinese"]);
    expect(nationsTypicalOfVariant("swamp-mud")).toEqual(["chinese", "maya"]);
  });

  it("lists the nations typical of a palette choice, auto included", () => {
    expect(nationsTypicalOfPalette("rock", "basalt")).toEqual(["viking", "japanese"]);
    expect(nationsTypicalOfPalette("rock", "redSandstone")).toEqual(["nubian", "persian"]);
    expect(nationsTypicalOfPalette("soil", "chalk")).toEqual(["roman"]);
    expect(nationsTypicalOfPalette("sand", "red")).toEqual(["nubian", "persian"]);
    expect(nationsTypicalOfPalette("soil", "auto")).toEqual([...NATIONS]);
  });

  it("builds the editor's typical-of tooltip text from the table", () => {
    const nations = nationsTypicalOfPalette("rock", "basalt");
    const names = nations.map(nation => displayNationName(nation)).join(", ");
    expect(translateMessage(undefined, M.info.typicalOf, { nations: names }))
      .toBe("Typical of: Viking, Japanese");
  });

  it("lists the nations typical of a grass cover kind", () => {
    expect(nationsTypicalOfCover("plant:tallGrass"))
      .toEqual(["viking", "japanese", "nubian", "indigenous", "chinese", "persian", "maya"]);
    expect(nationsTypicalOfCover("plant:dryTuft")).toEqual(["nubian", "indigenous", "persian"]);
    expect(nationsTypicalOfCover("plant:clover")).toEqual(["roman", "viking", "japanese", "chinese", "maya"]);
  });

  it("derives the editor's grass help from the table", () => {
    const associations = coverKindAssociations();
    expect(associations.length).toBeGreaterThan(0);
    expect(associations.every(({ nations }) => nations.length > 0)).toBe(true);
    for (const association of associations) expect(association.name.en.length).toBeGreaterThan(0);
    expect(associations.find(({ id }) => id === "plant:tallGrass")?.nations).toContain("indigenous");
  });

  it("derives the favoured numeric cover kinds for the generator and field cover", () => {
    const indigenous = favoredCoverKinds(getNationTerrainAffinity("indigenous"));
    expect(indigenous?.has(COVER.tallGrass)).toBe(true);
    expect(indigenous?.has(COVER.dryTuft)).toBe(true);
    const viking = favoredCoverKinds(getNationTerrainAffinity("viking"));
    expect(viking?.has(COVER.dryTuft)).toBe(false);
  });

  it("reads the affinity of a generated world from its recorded options", () => {
    const provenance = {
      generatorVersion: "test",
      options: { ...DEFAULT_WORLD_OPTIONS, nation: "viking" as const },
      version: 1 as const
    };
    expect(getWorldNationAffinity({ generationProvenance: provenance })?.palette.rock).toBe("basalt");
    expect(getWorldNationAffinity({})).toBeUndefined();
  });
});
