import { describe, expect, it } from "vitest";

import { validateMapScenario } from "../src/shared/settlement/settlement-map-scenario";
import {
  createMapScenario, isMapScenario, type MapScenario, type ScenarioUnit
} from "../src/shared/world/map-scenario";
import { activeFactionAi, type ScenarioFactionAi } from "../src/shared/world/scenario-faction-ai";
import {
  checkFactionAi, formatFactionAiIssue, hasFactionAiErrors, validScenarioFactionAi
} from "../src/shared/world/scenario-faction-ai-issues";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 40;
const BIG_MAP = { cellsX: 128, cellsZ: 128 };
const unit = (id: number, faction = 1): ScenarioUnit =>
  ({ faction, group: 0, heading: 0, id, rank: 0, type: "shield", x: 30 + id, z: 30 });
const adventure = (change: Partial<MapScenario> = {}): MapScenario =>
  ({ ...createMapScenario(), kind: "adventure", landing: { x: 8, z: 8 }, settlers: 0, units: [unit(1)], ...change });
const worldFixture = (scenario: MapScenario) => ({
  seed: 9, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 5.5, z: 5.5 },
  heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
  walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [], scenario,
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
}) as unknown as WorldData;
const develop = (change: Partial<ScenarioFactionAi> = {}): ScenarioFactionAi =>
  ({ faction: 1, mode: "develop", start: { settlers: 20, stock: { planks: 30 } }, ...change });
const maintain = (change: Partial<ScenarioFactionAi> = {}): ScenarioFactionAi =>
  ({ faction: 1, mode: "maintain", start: { settlers: 5, stock: { planks: 30 } }, ...change });
const shapeValid = (factionAi: unknown, kind = "adventure") => validScenarioFactionAi({ factionAi, kind });
const issuesOf = (factionAi: ScenarioFactionAi[], change: Partial<MapScenario> = {}, map = BIG_MAP) =>
  checkFactionAi(adventure({ factionAi, ...change }), map);
const codesOf = (...args: Parameters<typeof issuesOf>) => issuesOf(...args).map(issue => issue.code);

describe("faction AI shape guard", () => {
  it("accepts an absent field, an empty list and a fully authored entry", () => {
    expect(shapeValid(undefined)).toBe(true);
    expect(shapeValid(undefined, "home")).toBe(true);
    expect(shapeValid([])).toBe(true);
    expect(shapeValid([{ faction: 3, mode: "none" }, develop({
      bonus: { construction: 100, production: 300, training: 150 }, expand: false, level: "hard",
      limits: { buildings: 60, population: 150, soldiers: 80 },
      start: { settlers: 20, soldiers: [{ count: 4, rank: 1, type: "archer" }], stock: { planks: 30 } },
      style: "turtle"
    })])).toBe(true);
  });

  it("refuses unknown modes, styles, levels and fields, and a value that is no list", () => {
    expect(shapeValid({})).toBe(false);
    expect(shapeValid([{ faction: 1, mode: "conquer" }])).toBe(false);
    expect(shapeValid([{ faction: 1 }])).toBe(false);
    expect(shapeValid([develop({ style: "rush" as never })])).toBe(false);
    expect(shapeValid([develop({ level: "insane" as never })])).toBe(false);
    expect(shapeValid([{ ...develop(), cheat: true }])).toBe(false);
  });

  it("refuses factions outside 1–16 and duplicates", () => {
    expect(shapeValid([develop({ faction: 0 })])).toBe(false);
    expect(shapeValid([develop({ faction: 17 })])).toBe(false);
    expect(shapeValid([develop({ faction: 1.5 })])).toBe(false);
    expect(shapeValid([develop({ faction: 16 })])).toBe(true);
    const duplicate = checkFactionAi({ factionAi: [maintain(), develop()], kind: "colony" });
    expect(duplicate.map(issue => [issue.code, issue.path])).toEqual([["duplicateFaction", "factionAi[1].faction"]]);
  });

  it("refuses a style without develop, bonuses outside 100–300, foreign wares and limits out of range", () => {
    expect(shapeValid([maintain({ style: "balanced" })])).toBe(false);
    expect(shapeValid([{ faction: 1, mode: "none", style: "turtle" }])).toBe(false);
    expect(shapeValid([develop({ bonus: { production: 99 } })])).toBe(false);
    expect(shapeValid([develop({ bonus: { training: 301 } })])).toBe(false);
    expect(shapeValid([develop({ start: { settlers: 5, stock: { unobtainium: 1 } } })])).toBe(false);
    expect(shapeValid([develop({ start: { settlers: -1, stock: {} } })])).toBe(false);
    expect(shapeValid([develop({ start: { settlers: 5, soldiers: [{ count: 1, rank: 0, type: "cavalry" }],
      stock: {} } })])).toBe(false);
    expect(shapeValid([develop({ limits: { buildings: 0 } })])).toBe(false);
    expect(shapeValid([develop({ limits: { buildings: 61 } })])).toBe(false);
    expect(shapeValid([develop({ limits: { population: 151 } })])).toBe(false);
    expect(shapeValid([develop({ limits: { soldiers: 81 } })])).toBe(false);
    expect(shapeValid([develop({ limits: { soldiers: -1 } })])).toBe(false);
  });

  it("refuses faction AI on a home map and reports invalid fields by path", () => {
    expect(checkFactionAi({ factionAi: [], kind: "home" }).map(issue => issue.code)).toEqual(["onHomeMap"]);
    const invalid = checkFactionAi({ factionAi: [develop({ bonus: { production: 99 } })], kind: "colony" });
    expect(invalid.map(formatFactionAiIssue)).toEqual(["factionAi[0].bonus.production: invalid value."]);
    expect(hasFactionAiErrors(invalid)).toBe(true);
  });

  it("is part of the map-file guard, which keeps maps without the field valid", () => {
    expect(isMapScenario(adventure(), SIZE, SIZE)).toBe(true);
    expect(isMapScenario(adventure({ factionAi: [develop()] }), SIZE, SIZE)).toBe(true);
    expect(isMapScenario(adventure({ factionAi: [develop({ faction: 17 })] }), SIZE, SIZE)).toBe(false);
    expect(isMapScenario({ ...createMapScenario(), factionAi: [] }, SIZE, SIZE)).toBe(false);
  });
});

describe("faction AI Ready rules", () => {
  it("has no issue for maps without AI factions, whatever the player's start", () => {
    expect(issuesOf([], { settlers: 5000 })).toEqual([]);
    expect(issuesOf([{ faction: 1, mode: "none" }], { settlers: 5000 })).toEqual([]);
    expect(checkFactionAi(adventure({ settlers: 5000 }), BIG_MAP)).toEqual([]);
    expect(activeFactionAi([{ faction: 1, mode: "none" }, maintain({ faction: 2 })]).map(entry => entry.faction))
      .toEqual([2]);
  });

  it("accepts a develop faction with settlers and a maintain faction with stock", () => {
    expect(issuesOf([develop()])).toEqual([]);
    expect(issuesOf([maintain()])).toEqual([]);
  });

  it("refuses develop without start settlers", () => {
    expect(codesOf([develop({ start: { settlers: 0, stock: {} } })])).toEqual(["developWithoutSettlers"]);
    expect(codesOf([develop({ start: undefined })])).toEqual(["developWithoutSettlers"]);
  });

  it("refuses an AI faction with no units, no buildings and no start", () => {
    const issues = issuesOf([maintain({ faction: 2, start: undefined })]);
    expect(issues.map(issue => [issue.severity, issue.code, issue.path])).toEqual([
      ["error", "factionNeverActs", "factionAi[0]"], ["warning", "maintainWithoutStock", "factionAi[0].start.stock"]
    ]);
    expect(codesOf([maintain({ faction: 2 })])).toEqual([]);
  });

  it("refuses people limits that exceed the island target with the player's start", () => {
    expect(codesOf([develop()], { settlers: 370 })).toEqual([]);
    const issues = issuesOf([develop()], { settlers: 366, startTroops: [{ count: 5, rank: 0, type: "shield" }] });
    expect(issues.map(formatFactionAiIssue)).toEqual([
      "The computer factions' people limits and the player's start add up to 601; one island is planned for 600 people."
    ]);
    expect(codesOf([develop({ limits: { population: 100, soldiers: 50 } })], { settlers: 450 })).toEqual([]);
    const authored = [unit(1), unit(2)];
    const reserve = maintain({ start: { settlers: 5, soldiers: [{ count: 8, rank: 0, type: "shield" }],
      stock: { planks: 1 } } });
    expect(codesOf([reserve], { settlers: 570, units: authored })).toEqual([]);
    expect(codesOf([reserve], { settlers: 571, units: authored })).toEqual(["peopleAboveIslandTarget"]);
  });

  it("refuses a second develop faction beside any number of maintain factions", () => {
    const small = { limits: { population: 50, soldiers: 20 } };
    const issues = issuesOf([develop(small), develop({ ...small, faction: 2 })]);
    expect(issues.map(issue => [issue.severity, issue.code])).toEqual([["error", "multipleDevelopFactions"]]);
    expect(issues.map(formatFactionAiIssue)).toEqual([
      "2 computer factions develop an economy; a map may have 1, beside any number that maintain."
    ]);
    const play = validateMapScenario(worldFixture(adventure({
      factionAi: [develop(small), develop({ ...small, faction: 2 })], units: [unit(1), unit(2, 2)]
    })));
    expect(play).toEqual([formatFactionAiIssue(issues[0]!)]);
    expect(codesOf([develop(small), maintain({ faction: 2 }), maintain({ faction: 3 })])).toEqual([]);
  });

  it("warns about small develop maps, empty maintain stock and handicaps", () => {
    expect(codesOf([develop()], {}, { cellsX: 127, cellsZ: 128 })).toEqual(["developOnSmallMap"]);
    expect(codesOf([develop()], {}, {} as typeof BIG_MAP)).toEqual([]);
    expect(codesOf([maintain({ start: { settlers: 5, stock: { planks: 0 } } })])).toEqual(["maintainWithoutStock"]);
    expect(codesOf([develop({ bonus: { construction: 100 } })])).toEqual([]);
    const handicap = issuesOf([develop({ bonus: { construction: 120, training: 150 } })]);
    expect(handicap.map(formatFactionAiIssue)).toEqual(["Handicap: AI +50 % (computer faction 1)."]);
    expect(hasFactionAiErrors(handicap)).toBe(false);
  });

  it("blocks Play with the error messages only", () => {
    const play = (factionAi: ScenarioFactionAi[]) => validateMapScenario(worldFixture(adventure({ factionAi })));
    expect(validateMapScenario(worldFixture(adventure()))).toEqual([]);
    expect(play([develop()])).toEqual([]);
    expect(play([develop({ start: undefined })]))
      .toEqual(["Computer faction 1: the develop mode needs start settlers."]);
    expect(play([develop({ faction: 17 })])).toEqual(["factionAi[0].faction: invalid value."]);
  });
});
