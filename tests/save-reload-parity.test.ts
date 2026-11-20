import { describe, expect, it } from "vitest";

import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { militaryFieldSaveError } from "../src/shared/settlement/settlement-combat-field-save";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";
import { siegeScenario } from "../tools/bench/military-motion-scenarios";
import { advance, mannedFixture, sendAttackGroup } from "./helpers/military-assault-fixture";

/**
 * SAVE-DRIFT (2026-11-11): "save at tick N + reload" must continue exactly like the uninterrupted run (the
 * server verifier, offline catch-up and save/load tests rely on it). Each battle is saved at several ticks,
 * loaded into a fresh island and both are stepped side by side: the canonical state hash must agree every tick.
 */

/** `build` makes the battle (already started); `fresh` an island of the same world to load the save into. */
interface Battle { fresh: () => SettlementSimulation; sim: SettlementSimulation }

const stateHash = (sim: SettlementSimulation) => hashText(canonicalJson(sim.saveState()));

/** The first tick after the load at which the two runs differ (null: none within `ticks`). */
const firstDivergence = (build: () => Battle, checkpoint: number, ticks: number) => {
  const { fresh, sim } = build();
  for (let tick = 0; tick < checkpoint; tick++) sim.update(.05);
  const reloaded = fresh();
  expect(reloaded.loadState(JSON.parse(JSON.stringify(sim.saveState())))).toEqual({ ok: true });
  for (let tick = 0; tick < ticks; tick++) {
    sim.update(.05); reloaded.update(.05);
    if (stateHash(sim) !== stateHash(reloaded)) return tick;
  }
  return null;
};

const skirmish = (): Battle => {
  const make = () => createBalanceSimulation(48, 123);
  const sim = make();
  sim.receiveTroops([{ hp: militaryHealth("shield", 2), rank: 2, type: "shield" }]);
  expect(sim.commandMilitary([sim.militarySoldiers()[0]!.actor], { x: 23, z: 23 }, "move")).toBe(true);
  advance(sim, 90);
  expect(sim.startMilitaryTestSkirmish()).toHaveLength(3);
  return { fresh: make, sim };
};

const siege = (): Battle => {
  const scenario = siegeScenario();
  scenario.start();
  return { fresh: () => siegeScenario().simulation, sim: scenario.simulation };
};

const fortAssault = (): Battle => {
  const { sim, site } = mannedFixture(4);
  sendAttackGroup(sim, site.access, 6, 1);
  return { fresh: () => mannedFixture(4).sim, sim };
};

describe("save and reload continue exactly like the uninterrupted run", () => {
  it.each([
    ["field skirmish", skirmish, [80, 400]],
    ["siege at a manned watchtower (door fight, queue, riders)", siege, [200, 600]],
    ["assault on a player fort (garrison order, wall places)", fortAssault, [200, 400]]
  ] as const)("%s", (_name, build, checkpoints) => {
    for (const checkpoint of checkpoints) expect(firstDivergence(build, checkpoint, 300)).toBeNull();
  }, 240_000);

  it("saves no battlefield block on an island without a battle", () => {
    const sim = createBalanceSimulation(48, 123);
    advance(sim, 2);
    expect(sim.saveState().military?.combat).not.toHaveProperty("field");
  });

  it("refuses a malformed battlefield block", () => {
    expect(militaryFieldSaveError(undefined)).toBeNull();
    expect(militaryFieldSaveError({ memories: [[1, { seekTime: 0, struck: false }]] })).toBeNull();
    expect(militaryFieldSaveError({ memories: [[-1, { seekTime: 0, struck: false }]] })).not.toBeNull();
    expect(militaryFieldSaveError({ steering: { motions: [[1, { age: Number.NaN, x: 0, z: 0 }]] } }))
      .not.toBeNull();
    expect(militaryFieldSaveError({ arriving: [{ uids: [1] }] })).not.toBeNull();
    expect(militaryFieldSaveError([])).not.toBeNull();
  });
});
