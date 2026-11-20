import { buildingEntry } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import type { MapScript, ScriptEvent } from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, num, numberVariable, ref, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { verifyCommandLogs } from "../src/app/settlement/command-log-verify";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { SAWMILL_TYPE_ID, WOODCUTTER_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { scriptIslandSave } from "./helpers/script-verify-island";

/**
 * TRG4b: proximity events on the server bundle's headless island. Settlers of a played interval come near the
 * sawmill (`cameNear`, a static auto-circle) and near the settler the script stored last (`cameNearMoving`, an
 * actor variable). The server verifier replays the command log and must reach the same state hash, which covers
 * the script run state (counters and the stored actor), so the client session and the server emitted identically.
 */

const SLOW_TIMEOUT = 300_000;
const MAX_TICKS = 12_000;
const MIN_TICKS = 2400;

const any = { kind: "any" } as const;
const sawmill = { kind: "type", type: { type: ref("content", buildingEntry(SAWMILL_TYPE_ID)!.id) } };
const count = (id: string) => doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", id) });

const proximityScript = (): MapScript => emptyScript({
  triggers: [
    trigger("near", {
      actions: [count("v-near"), doStep("s2", "storeActor", { mode: str("replace"),
        selector: { key: "enteringActor", kind: "response" }, variable: ref("variable", "a-last") })],
      events: [{ kind: "cameNear", player: any, slots: { radius: num(4), target: sawmill } } as unknown as ScriptEvent]
    }),
    trigger("moving", {
      actions: [count("v-moving")],
      events: [{ kind: "cameNearMoving", player: any, slots: { radius: num(2),
        target: { kind: "variable", variable: ref("variable", "a-last") } } } as unknown as ScriptEvent]
    })
  ],
  variables: [numberVariable("v-near", "near"), numberVariable("v-moving", "moving"),
    { id: "a-last", initial: { type: "actor", value: [] }, name: "last", type: "actor" }]
});

describe("TRG4b proximity events, client session vs server verification", () => {
  it("counts approaches of the sawmill and of a stored settler and verifies the played log", async () => {
    const save = await scriptIslandSave(proximityScript(), "Proximity island");
    const client = await createHeadlessIsland(save), { simulation } = client;
    expect(simulation.script()).toBeDefined();
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    const value = (id: string) => simulation.script()!.engine.state.values[id]?.value as number;
    recorder.open();
    const [width, depth] = getBuildingDefinition(WOODCUTTER_TYPE_ID).gridFootprint;
    const woodcutter = simulation.placeBuilding(WOODCUTTER_TYPE_ID, 20 + width / 2, 44 + depth / 2);
    expect(woodcutter.ok, woodcutter.reason).toBe(true);
    expect(simulation.connectRoads(simulation.headquarters.access, woodcutter.building!.access)).toBe(true);
    const done = () => value("v-near") >= 3 && value("v-moving") >= 1;
    let ticks = 0;
    for (; ticks < MAX_TICKS && (ticks < MIN_TICKS || !done()); ticks++) simulation.update(.05);
    const interval = recorder.close("home")!;
    expect(value("v-near")).toBeGreaterThanOrEqual(3);
    expect(value("v-moving")).toBeGreaterThanOrEqual(1);
    const end = toSaveSnapshot(await client.save!());
    expect(await verifyCommandLogs({ base: toSaveSnapshot(save), end, intervals: [{ ...interval, baseRevision: 1 }] }))
      .toMatchObject({ status: "verified", ticks });
  }, SLOW_TIMEOUT);
});
