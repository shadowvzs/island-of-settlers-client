import { describe, expect, it } from "vitest";

import type { MapScript, ScriptEvent } from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, num, numberVariable, ref, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { verifyCommandLogs } from "../src/app/settlement/command-log-verify";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { WOODCUTTER_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import type { MerchantOffer } from "../src/shared/trade/trade-types";
import { scriptIslandSave } from "./helpers/script-verify-island";

/**
 * EXT-EVENTS: economy events on the server bundle's headless island. A played interval builds a woodcutter (completed)
 * while the sawmill produces planks, buys a merchant offer and sells an own offer to an NPC buyer; the trade ships
 * deliver both. The
 * server verifier replays the command log and must reach the same state hash, which covers the script run state
 * (the counting variables), so the client session and the server emitted identically.
 */

const SLOW_TIMEOUT = 300_000;
const MAX_TICKS = 40_000;

const any = { kind: "any" } as const;
const ware = (key: string) => ref("content", `ware:${key}`);
const EVENTS: Record<string, ScriptEvent> = {
  arrived: { kind: "tradeDeliveryArrived", player: any, slots: {} },
  bought: { kind: "wareBought", player: any, slots: { ware: ware("logs") } },
  completed: { kind: "constructionCompleted", player: any, slots: {} },
  produced: { kind: "wareProduced", player: any, slots: { ware: ware("planks") } },
  sold: { kind: "wareSold", player: any, slots: { ware: ware("stone") } }
} as Record<string, ScriptEvent>;

/** Every event counts its fires; deliveries also add up their unloaded amounts. */
const economyScript = (): MapScript => emptyScript({
  triggers: [
    ...Object.entries(EVENTS).map(([id, event]) => trigger(id, {
      actions: [doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", `v-${id}`) })],
      events: [event]
    })),
    trigger("delivered", {
      actions: [doStep("s1", "increaseVariable", { amount: { k: "resp", key: "amount" },
        variable: ref("variable", "v-delivered") })],
      events: [EVENTS.arrived!]
    })
  ],
  variables: [...Object.keys(EVENTS), "delivered"].map(id => numberVariable(`v-${id}`, id))
});

const MARKET: MerchantOffer[] = [{ give: { amount: 10, ware: "logs" }, id: "m0-0", merchant: "Livia Portus",
  status: "open", want: { amount: 2, ware: "fish" } }];

const economyIslandSave = () => scriptIslandSave(economyScript(), "Economy island",
  settlement => Object.assign(settlement.trade!, { market: { day: 0, level: 1, offers: MARKET }, npcTraders: true }));

describe("EXT-EVENTS economy events, client session vs server verification", () => {
  it("counts completed, produced, bought, sold and delivered and verifies the played log", async () => {
    const save = await economyIslandSave();
    const client = await createHeadlessIsland(save), { simulation } = client;
    expect(simulation.script()).toBeDefined();
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    const values = () => simulation.script()!.engine.state.values;
    const count = (id: string) => values()[`v-${id}`]?.value as number;
    recorder.open();
    const [width, depth] = getBuildingDefinition(WOODCUTTER_TYPE_ID).gridFootprint;
    const woodcutter = simulation.placeBuilding(WOODCUTTER_TYPE_ID, 20 + width / 2, 44 + depth / 2);
    expect(woodcutter.ok, woodcutter.reason).toBe(true);
    expect(simulation.connectRoads(simulation.headquarters.access, woodcutter.building!.access)).toBe(true);
    expect(simulation.tradeBuy("m0-0")).toBe(true);
    expect(simulation.tradePlaceOffer({ amount: 30, ware: "stone" }, { amount: 8, ware: "fish" })).toBe(true);
    const done = () => count("arrived") >= 2 && count("produced") >= 2 && count("completed") >= 1;
    let ticks = 0;
    for (; ticks < MAX_TICKS && !done(); ticks++) simulation.update(.05);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name))
      .toEqual(["placeBuilding", "connectRoads", "tradeBuy", "tradePlaceOffer"]);
    expect({ arrived: count("arrived"), bought: count("bought"), completed: count("completed"),
      delivered: count("delivered"), sold: count("sold") })
      .toEqual({ arrived: 2, bought: 1, completed: 1, delivered: 18, sold: 1 });
    expect(count("produced")).toBeGreaterThanOrEqual(2);
    const end = toSaveSnapshot(await client.save!());
    expect(await verifyCommandLogs({ base: toSaveSnapshot(save), end, intervals: [{ ...interval, baseRevision: 1 }] }))
      .toMatchObject({ status: "verified", ticks });
  }, SLOW_TIMEOUT);
});
