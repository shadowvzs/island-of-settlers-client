import { describe, expect, it } from "vitest";

import { LEGACY_SIM_RULES, type SimRules } from "../../island-of-settlers-shared/src/game-settings/sim-rules";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";
import { advance } from "./helpers/military-assault-fixture";

/** PROG (plan §9.1): rules that switch talents off keep every island's talent modifiers neutral. */

const TALENTS_OFF: SimRules = { ...LEGACY_SIM_RULES, revision: "rev-talents-off", talents: false };
const TALENTS_ON: SimRules = { ...LEGACY_SIM_RULES, revision: "rev-talents-on" };
const RANKS = { carrierSpeed: 5 };

const island = () => createBalanceSimulation(48, 321);
const hashOf = (sim: SettlementSimulation) => hashText(canonicalJson(sim.saveState()));

describe("talent rules in the simulation", () => {
  it("applies ranks under today's rules", () => {
    const sim = island();
    expect(sim.setTalentRanks(RANKS)).toBe(true);
    expect(sim.talentModifiers().carrierSpeed).toBeGreaterThan(0);
  });

  it("refuses ranks while talents are off and accepts them again once switched on", () => {
    const sim = island();
    sim.adoptGameRules(TALENTS_OFF);
    expect(sim.setTalentRanks(RANKS)).toBe(false);
    expect(sim.talentModifiers().carrierSpeed).toBe(0);
    sim.adoptGameRules(TALENTS_ON);
    expect(sim.setTalentRanks(RANKS)).toBe(true);
    expect(sim.talentModifiers().carrierSpeed).toBeGreaterThan(0);
  });

  it("adopting rules without talents drops the applied modifiers", () => {
    const sim = island();
    sim.setTalentRanks(RANKS);
    expect(sim.adoptGameRules(TALENTS_OFF)).toBe(true);
    expect(sim.talentModifiers().carrierSpeed).toBe(0);
  });

  it("a talents-off interval replays to the same hash as an island that never had talents", () => {
    const sim = island(), plain = island();
    advance(sim, .5);
    advance(plain, .5);
    const replica = island();
    expect(replica.loadState(structuredClone(sim.saveState())).ok).toBe(true);
    const recorder = createCommandLogRecorder(sim, { sourceVersion: "test" });
    recorder.open();
    sim.setTalentRanks(RANKS);
    sim.adoptGameRules(TALENTS_OFF);
    sim.setTalentRanks(RANKS);
    plain.adoptGameRules(TALENTS_OFF);
    advance(sim, 2);
    advance(plain, 2);
    const interval = recorder.close("home")!;
    expect(replayCommandLog(replica, interval)).toEqual({ endChecksum: interval.endChecksum, ok: true });
    expect(hashOf(replica)).toBe(hashOf(sim));
    expect(hashOf(plain)).toBe(hashOf(sim));
  }, 120_000);
});
