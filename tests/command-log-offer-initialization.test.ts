import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import type { CommandLogVerificationInput } from "../src/app/settlement/command-log-verify";
import { verifyCommandLogs } from "../src/app/settlement/command-log-verify";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createColonyExpeditions } from "../src/shared/settlement/settlement-colony-expeditions";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { createRecoveryAccountFixture } from "../tools/bench/commander-recovery-account-fixture";

let baseline: GameSaveV1;
beforeAll(async () => { baseline = (await createRecoveryAccountFixture()).game; });

describe("canonical offer initialization before UI reads", () => {
  it("verifies the exact formerly failing47tick authenticated browser endpoint without hash exclusions", async () => {
    const inputs: CommandLogVerificationInput[] = JSON.parse(readFileSync(
      new URL("./fixtures/account-offer-replay-2774d757.json", import.meta.url), "utf8"));
    expect(inputs).toHaveLength(1);
    expect(await verifyCommandLogs(inputs[0]!)).toEqual({ status: "verified", ticks: 47 });
    const forged = structuredClone(inputs[0]!);
    const game = forged.end.islands[0]!.save.data as unknown as GameSaveV1;
    game.settlement.naval.colonies!.colonyOffers![0]!.seed++;
    expect(await verifyCommandLogs(forged)).toMatchObject({ status: "mismatch",
      mismatch: { kind: "snapshot" } });
  });

  it("initializes absent batches once from the saved UTC calendar; queries and reloads preserve identities/RNG", async () => {
    const cold = structuredClone(baseline);
    cold.savedAt = Date.UTC(2026, 10, 4);
    const state = cold.settlement.naval.colonies!;
    delete state.colonyOffers; delete state.adventureOffers; delete state.discoveryTimeZone;
    const original = structuredClone(cold);
    const { simulation } = await createHeadlessIsland(cold);
    expect(cold).toEqual(original);
    const before = simulation.saveState(), random = simulation.randomAudit().states();
    expect(before.naval.colonies!.discoveryTimeZone).toBe("UTC");
    expect(before.naval.colonies!.colonyOffers).toHaveLength(6);
    expect(before.naval.colonies!.adventureOffers).toHaveLength(4);
    for (let read = 0; read < 50; read++) { simulation.colonyIslands(); simulation.adventureIslands(); }
    expect(simulation.saveState()).toEqual(before);
    expect(simulation.randomAudit().states()).toEqual(random);
    for (let reload = 0; reload < 5; reload++) {
      expect(simulation.reloadSnapshot(simulation.saveState(), true).ok).toBe(true);
      simulation.colonyIslands(); simulation.adventureIslands();
      expect(simulation.saveState()).toEqual(before);
      expect(simulation.randomAudit().states()).toEqual(random);
    }
    const later = structuredClone(cold);
    later.savedAt = Date.UTC(2027, 6, 4); later.settlement = before;
    const restored = await createHeadlessIsland(later);
    expect(restored.simulation.saveState().naval.colonies).toEqual(before.naval.colonies);
    expect(before.naval.colonies!.colonyOffers![0]!.discovery!.month).toBe(11);
  });

  it("commits replacement adventures at the existing release command, before any later view query", () => {
    let now = Date.UTC(2026, 10, 4);
    const context = { options: { now: () => now, playerLevel: () => 23, world: { seed: 42 } },
      actors: [], buildings: [] } as unknown as SettlementContext;
    const api = createColonyExpeditions(context, { fleet: { pending: () => [], snapshot: () => [] },
      passengers: { release: () => {} } } as unknown as Parameters<typeof createColonyExpeditions>[1]);
    const before = api.saveState();
    api.restore({ ...before, expeditions: [{ id: 1, sourceUid: 0, island: before.adventureOffers![0]!,
      status: "arrived", troops: {}, cargo: {}, crew: [], passengers: [], loads: 0, departed: 0, arrived: 0,
      emigrants: [], landed: {}, elapsed: 0, estimate: 0 }] } as never);
    now = Date.UTC(2027, 6, 4);
    expect(api.release(1)).toBe(true);
    const committed = api.saveState();
    expect(committed.adventureRound).toBe(1);
    expect(committed.adventureOffers![0]!.discovery!.month).toBe(7);
    expect(committed.colonyOffers).toEqual(before.colonyOffers);
    now = Date.UTC(2027, 11, 4);
    api.adventureIslands();
    expect(api.saveState()).toEqual(committed);
  });
});
