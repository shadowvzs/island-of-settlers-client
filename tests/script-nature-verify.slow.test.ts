import { describe, expect, it } from "vitest";

import type { MapScript, ScriptEvent } from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, num, numberVariable, ref, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { verifyCommandLogs } from "../src/app/settlement/command-log-verify";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { FORESTER_TYPE_ID, WOODCUTTER_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { determinismIslandSave } from "./helpers/determinism-island";

/**
 * TRG3b: tree events on the server bundle's headless island (the same `createIslandResources` hooks as the
 * client island). A played interval with a woodcutter and a forester counts cut, planted and growth-stage
 * events; the server verifier replays the log and must reach the same state hash, which covers the script run
 * state (fire counts, variables, generations), so client and server emitted identically.
 */

const SLOW_TIMEOUT = 300_000;
const PLAYED_TICKS = 9600;

const counter = (id: string, event: ScriptEvent) => trigger(id, {
  actions: [doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", `v-${id}`) })],
  events: [event]
});

const any = { kind: "any" } as const;
const COUNTERS: Record<string, ScriptEvent> = {
  cut: { kind: "treeCut", player: { faction: 0, kind: "slot" },
    slots: { by: { kind: "type", type: { type: ref("content", "settler:woodcutter") } } } } as ScriptEvent,
  mature: { kind: "treeGrowthStage", player: any, slots: { stage: num(5) } } as ScriptEvent,
  planted: { kind: "treePlanted", player: any, slots: {} } as ScriptEvent,
  stage: { kind: "treeGrowthStage", player: any, slots: {} } as ScriptEvent
};

const natureScript = (): MapScript => emptyScript({
  triggers: Object.entries(COUNTERS).map(([id, event]) => counter(id, event)),
  variables: Object.keys(COUNTERS).map(id => numberVariable(`v-${id}`, id))
});

describe("TRG3b tree events, client session vs server verification", () => {
  it("counts cut, planted and grown trees and verifies the played log", async () => {
    const save = await determinismIslandSave(natureScript());
    const client = await createHeadlessIsland(save), { simulation } = client;
    expect(simulation.script()).toBeDefined();
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    const build = (type: number, x: number, z: number) => {
      const [width, depth] = getBuildingDefinition(type).gridFootprint;
      const placed = simulation.placeBuilding(type, x + width / 2, z + depth / 2);
      expect(placed.ok, placed.reason).toBe(true);
      expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
    };
    recorder.open();
    build(WOODCUTTER_TYPE_ID, 34, 30);
    build(FORESTER_TYPE_ID, 34, 40);
    // The forester's first sapling goes in after about four minutes; it matures 120 s later.
    for (let tick = 0; tick < PLAYED_TICKS; tick++) simulation.update(.05);
    const interval = recorder.close("home")!;
    const values = simulation.script()!.engine.state.values;
    const count = (id: string) => values[`v-${id}`]?.value as number;
    expect(count("cut")).toBeGreaterThan(0);
    expect(count("planted")).toBeGreaterThan(0);
    expect(count("stage")).toBeGreaterThan(count("mature"));
    expect(count("mature")).toBeGreaterThan(0);
    const end = toSaveSnapshot(await client.save!());
    expect(await verifyCommandLogs({ base: toSaveSnapshot(save), end, intervals: [{ ...interval, baseRevision: 1 }] }))
      .toMatchObject({ status: "verified", ticks: PLAYED_TICKS });
  }, SLOW_TIMEOUT);
});
