import { describe, expect, it } from "vitest";

import {
  type CampaignMap, createCampaign, createCampaignMap
} from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { DEFAULT_ONLINE_SETTINGS } from "../../island-of-settlers-shared/src/game-settings/game-settings";
import type { MapScript } from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, ref, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { checkWholeCampaign } from "../src/app/map-editor/campaign/campaign-readiness";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { type MapSaveInput, writeMapFile } from "../src/shared/world/save/map-writer";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(SMALL_EDITOR_WORLD);

/** BR2: the campaign Check reads the map's exits against the `endMap` actions of its map file. */

const INPUT: MapSaveInput = { animals: [], name: "Exits", savedAt: 1_700_000_000_000, source: "test" };
const SLOT = "campaign/c1/m1";

const endsThrough = (...exits: string[]): MapScript => emptyScript({ triggers: exits.map((exit, index) =>
  trigger(`end-${index}`,
    { actions: [doStep("s1", "endMap", { exit: ref("exit", exit), outcome: str("victory") })] })) });

const mapWith = (exits: string[]): CampaignMap => ({
  ...createCampaignMap("m1", "c1", { hash: null, id: SLOT }),
  exits: exits.map(id => ({ id, name: { en: id } }))
});

const check = async (map: CampaignMap, script: MapScript) => {
  const world = { ...cachedWorld(SMALL_EDITOR_WORLD), scenario: { ...createMapScenario(), kind: "campaign" as const },
    script };
  const bytes = await writeMapFile(world, INPUT, { codec: "gzip" });
  const campaign = { ...createCampaign("c1"), mapIds: ["m1"] };
  const report = await checkWholeCampaign(campaign, [map], {
    imageIds: new Set(), readBytes: async slot => (slot === SLOT ? bytes : null), settings: DEFAULT_ONLINE_SETTINGS
  });
  const [entry] = report.maps;
  return {
    record: entry!.result.warnings.filter(issue => issue.code === "campaignExitUnused"),
    script: [...entry!.script!.errors, ...entry!.script!.warnings].filter(issue => issue.code.startsWith("endMap"))
  };
};

describe("campaign Check: map exits (BR2)", () => {
  it("flags an endMap exit the map does not declare and a declared exit no endMap names", async () => {
    const found = await check(mapWith(["exit-1", "exit-2"]), endsThrough("exit-1", "exit-9", "victory"));
    expect(found.script.map(issue => [issue.code, issue.params.exit, issue.path])).toEqual(
      [["endMapUnknownExit", "exit-9", "triggers[1].actions[0].args.exit"]]);
    expect(found.record.map(issue => [issue.params.exit, issue.path])).toEqual([["exit-2", "exits[1]"]]);
  });

  it("is clean when every declared exit is used and every used exit is declared", async () => {
    expect(await check(mapWith(["exit-1"]), endsThrough("exit-1"))).toEqual({ record: [], script: [] });
  });

  it("checks a map without declared exits against the implicit victory exit", async () => {
    const found = await check(mapWith([]), endsThrough("exit-1"));
    expect(found.script.map(issue => issue.code)).toEqual(["endMapUnknownExit"]);
  });
});
