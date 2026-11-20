import { expect, it } from "vitest";

import { createMapScenario, isMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import {
  convertRetiredScenarioBanditSites, validScenarioBanditSite
} from "../src/shared/world/scenario-bandit-sites";

const camp = { defenders: 0, enclosure: "building" as const, faction: 1, id: 1, rotation: 1, x: 28, z: 12.5 };
const scenarioWith = (building: object) =>
  ({ ...createMapScenario(), kind: "colony", buildings: [building] }) as unknown as MapScenario;

it("stores a bandit site as its catalog code and layout, with the catalog's military building type", () => {
  expect(validScenarioBanditSite({ type: 1, defenders: 2 })).toBe(true);
  expect(validScenarioBanditSite({ bandit: { code: 0, layout: 2 }, defenders: 4, type: 2 })).toBe(true);
  expect(validScenarioBanditSite({ bandit: { code: 0, layout: 2 }, defenders: 5, type: 2 })).toBe(false);
  expect(validScenarioBanditSite({ bandit: { code: 0, layout: 2 }, defenders: 0, type: 4 })).toBe(false);
  expect(validScenarioBanditSite({ bandit: { code: 3, layout: 0 }, defenders: 0, type: 2 })).toBe(false);
  expect(validScenarioBanditSite({ bandit: { code: 1, layout: 3 }, defenders: 0, type: 4 })).toBe(false);
});

it("converts the retired building type plus model once and refuses what it cannot convert", () => {
  const retired = scenarioWith({ ...camp, model: 2, type: 2 });
  expect(isMapScenario(retired, 64, 64)).toBe(false);
  convertRetiredScenarioBanditSites(retired);
  expect(retired.buildings[0]).toEqual({ ...camp, bandit: { code: 0, layout: 2 }, type: 2 });
  expect(isMapScenario(retired, 64, 64)).toBe(true);
  const before = JSON.stringify(retired);
  convertRetiredScenarioBanditSites(retired);
  expect(JSON.stringify(retired)).toBe(before);
  const barracks = scenarioWith({ ...camp, enclosure: undefined, model: 0, type: 1 });
  convertRetiredScenarioBanditSites(barracks);
  expect(isMapScenario(barracks, 64, 64)).toBe(false);
});
