import { describe, expect, it } from "vitest";

import { valueStateKey } from "../src/shared/settlement/event-core/value-state";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { pausedProductionSettlement, sealSettlement } from "./helpers/quiet-paused-building";

const START = 10_000_000;
const RESUME_SECONDS = 60;
const TIMEOUT = 300_000;

const COLONY_ISLAND = {
  id: 1, name: "Test colony", difficulty: "easy", ore: "stone", seed: 1, voyageSeconds: 1
} as const;
const ADVENTURE_ISLAND = {
  kind: "adventure", id: 1, name: "Test adventure", difficulty: "easy", seed: 1, voyageSeconds: 1, size: 64
} as const;
/** The anchored landing ship and gangway: static, with every soldier already ashore. */
const LANDING = {
  ashore: 0, water: { x: 20, z: 20 }, yaw: 0,
  gangway: {
    shore: { x: 20, z: 20 }, point: { x: 20, z: 20 }, contact: { x: 20, z: 20 }, shoreY: 2, y: 2
  }
} as const;

/**
 * A completed expedition record over an otherwise quiet island. Its cleanup has finished: no
 * hostile building remains, the colony has no raid ship or raider left, and the adventure's
 * landing ship has every soldier ashore.
 */
const expeditionSettlement = (kind: "colony" | "adventure") => {
  const { settlement, world } = pausedProductionSettlement(17);
  if (kind === "colony")
    settlement.colony = { version: 1, island: COLONY_ISLAND, status: "conquered", forts: 3, conqueredAt: START,
      counterattack: { landTime: 60, shipTime: 120, raiders: [] } };
  else
    settlement.adventure = { version: 1, island: ADVENTURE_ISLAND, status: "won", enemies: 15, endedAt: START,
      landing: LANDING };
  sealSettlement(settlement);
  return { world, settlement };
};

const makeSimulation = (kind: "colony" | "adventure") => {
  const { settlement, world } = expeditionSettlement(kind);
  const simulation = createSettlementSimulation({
    world, roads: createRoadNetwork(world, { isBlocked: () => false }), clockStart: START, now: () => START
  });
  const loaded = simulation.loadState(structuredClone(settlement));
  expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
  return simulation;
};

const state = (simulation: ReturnType<typeof makeSimulation>) =>
  valueStateKey({ settlement: simulation.saveState() });

describe.each(["colony", "adventure"] as const)("quiet completed %s", kind => {
  describe.each([180, 600])("(%i s)", seconds => {
    it("matches the fixed tick while no hostile structure remains", () => {
      const exact = makeSimulation(kind), quiet = makeSimulation(kind);
      exact.update(0.05); quiet.update(0.05);
      expect(quiet.quietSkipStatus()).toEqual({ quiet: true });

      expect(quiet.advanceQuietTicks(seconds * 20), "the whole quiet stretch was claimed")
        .toBe(seconds * 20);
      for (let tick = 0; tick < seconds * 20; tick++) exact.update(0.05);

      expect(state(quiet), "E1 value state").toEqual(state(exact));
      expect(quiet.workCounters()).toEqual(exact.workCounters());
      expect(quiet.gameTick()).toBe(exact.gameTick());

      for (let tick = 0; tick < RESUME_SECONDS * 20; tick++) {
        exact.update(0.05); quiet.update(0.05);
      }
      expect(state(quiet), "E3 resume value state").toEqual(state(exact));
    }, TIMEOUT);
  });
});
