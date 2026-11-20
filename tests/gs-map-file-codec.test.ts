import { expect, it } from "vitest";

import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(SMALL_EDITOR_WORLD);

const INPUT = { animals: [], name: "Rules island", savedAt: 1_700_000_000_000, source: "gs-map" };

const scenarioWithRules = (): MapScenario => ({
  ...createMapScenario(), kind: "adventure", landing: { x: 20, z: 20 }, nation: "indigenous",
  rules: { experience: "none", features: { colonies: "off" }, level: { kind: "fixed", level: 4 } },
  startTroops: [{ count: 5, rank: 1, type: "archer" }]
});

it("round-trips the map rules and start soldiers and writes nothing for maps without them", async () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  world.scenario = scenarioWithRules();
  const { world: restored } = await readMapFile(await writeMapFile(world, INPUT));
  expect(restored.scenario?.rules).toEqual(world.scenario.rules);
  expect(restored.scenario?.startTroops).toEqual(world.scenario.startTroops);
  world.scenario = createMapScenario();
  const { world: plain } = await readMapFile(await writeMapFile(world, INPUT));
  expect(plain.scenario && "rules" in plain.scenario).toBe(false);
  expect(plain.scenario && "startTroops" in plain.scenario).toBe(false);
});

it("round-trips computer faction AI and keeps a map without it unchanged", async () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  const factionAi: MapScenario["factionAi"] = [{
    bonus: { production: 150 }, faction: 2, level: "hard", limits: { soldiers: 40 }, mode: "develop",
    start: { settlers: 12, soldiers: [{ count: 3, rank: 0, type: "shield" }], stock: { planks: 20 } }, style: "turtle"
  }];
  world.scenario = { ...scenarioWithRules(), factionAi };
  const { world: restored } = await readMapFile(await writeMapFile(world, INPUT));
  expect(restored.scenario?.factionAi).toEqual(factionAi);
  world.scenario = scenarioWithRules();
  const { world: old } = await readMapFile(await writeMapFile(world, INPUT));
  expect(old.scenario).toEqual(scenarioWithRules());
  expect(old.scenario && "factionAi" in old.scenario).toBe(false);
});

it("refuses a map file whose rules the map kind forbids", async () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  world.scenario = { ...scenarioWithRules(), kind: "home", landing: undefined };
  delete world.scenario.landing;
  await expect(async () => readMapFile(await writeMapFile(world, INPUT))).rejects.toThrow(/scenario/);
});
