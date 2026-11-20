import { describe, expect, it } from "vitest";

import { LEGACY_RULES_REVISION } from "../../island-of-settlers-shared/src/game-settings/constants";
import { GAME_SETTINGS_PRESETS } from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { effectiveRules } from "../../island-of-settlers-shared/src/game-settings/effective-rules";
import {
  isLocalRulesRevision, LEGACY_SIM_RULES, localRulesRevision, type SimRules
} from "../../island-of-settlers-shared/src/game-settings/sim-rules";
import { buildingUnlockLevel } from "../src/shared/progression/building-unlocks";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import {
  INVALID_GAME_RULES, localSessionRules, needsRulesAdoption
} from "../src/shared/settlement/sim-rules";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";
import { advance } from "./helpers/military-assault-fixture";

/** GS2: the island save pins the game rules; only the recorded `adoptGameRules` changes them. */

const FIXED_LEVEL_ONE: SimRules = { ...LEGACY_SIM_RULES, level: { kind: "fixed", level: 1 }, revision: "rev-fixed" };
/** A building the fixed level 1 locks (any type above level 1). */
const LOCKED_TYPE = Array.from({ length: 80 }, (_, typeId) => typeId).find(typeId => buildingUnlockLevel(typeId) > 1)!;

const island = () => createBalanceSimulation(48, 321);
const hashOf = (sim: SettlementSimulation) => hashText(canonicalJson(sim.saveState()));

describe("pinned game rules", () => {
  it("a legacy island saves no rules and plays today's effective rules", () => {
    const sim = island();
    expect("gameRules" in sim.saveState()).toBe(false);
    expect(sim.gameRules()).toBeUndefined();
    expect(sim.effectiveGameRules()).toEqual(effectiveRules(LEGACY_SIM_RULES, undefined, "home"));
    expect(sim.buildingLockLevel(LOCKED_TYPE)).toBeNull();
  });

  it("adoptGameRules is recorded, replays to the same hash and pins the rules every level reader sees", () => {
    const sim = island();
    advance(sim, .5);
    const replica = island();
    expect(replica.loadState(structuredClone(sim.saveState())).ok).toBe(true);
    const recorder = createCommandLogRecorder(sim, { sourceVersion: "test" });
    recorder.open();
    expect(sim.adoptGameRules(FIXED_LEVEL_ONE)).toBe(true);
    advance(sim, 1);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name)).toEqual(["adoptGameRules"]);
    expect(replayCommandLog(replica, interval)).toEqual({ endChecksum: interval.endChecksum, ok: true });
    expect(hashOf(replica)).toBe(hashOf(sim));
    expect(replica.gameRules()).toEqual(FIXED_LEVEL_ONE);
    expect(sim.effectiveGameRules().level).toEqual({ kind: "fixed", level: 1 });
    expect(sim.buildingLockLevel(LOCKED_TYPE)).toBe(buildingUnlockLevel(LOCKED_TYPE));
  }, 120_000);

  it("a pinned save reloads to the same hash and keeps its rules; in-place reload too", () => {
    const sim = island();
    sim.adoptGameRules(FIXED_LEVEL_ONE);
    advance(sim, .5);
    const saved = sim.saveState();
    expect(saved.gameRules).toEqual(FIXED_LEVEL_ONE);
    const reloaded = island();
    expect(reloaded.loadState(structuredClone(saved)).ok).toBe(true);
    expect(hashOf(reloaded)).toBe(hashOf(sim));
    expect(reloaded.gameRules()).toEqual(FIXED_LEVEL_ONE);
    expect(sim.reloadSnapshot(sim.saveState(), true).ok).toBe(true);
    expect(sim.gameRules()).toEqual(FIXED_LEVEL_ONE);
    advance(sim, .5);
    advance(reloaded, .5);
    expect(hashOf(reloaded)).toBe(hashOf(sim));
  }, 120_000);

  it("refuses an invalid document, rejects invalid saved rules, and the legacy revision clears the pin", () => {
    const sim = island();
    expect(sim.adoptGameRules({ revision: "x" })).toBe(INVALID_GAME_RULES);
    expect(sim.gameRules()).toBeUndefined();
    const legacyHash = hashOf(sim);
    sim.adoptGameRules(FIXED_LEVEL_ONE);
    expect(island().loadState({ ...sim.saveState(), gameRules: { revision: "x" } }).ok).toBe(false);
    expect(sim.adoptGameRules(LEGACY_SIM_RULES)).toBe(true);
    expect(sim.gameRules()).toBeUndefined();
    expect(hashOf(sim)).toBe(legacyHash);
  });

  it("an island adopts only another revision than it pinned", () => {
    expect(needsRulesAdoption(undefined, undefined)).toBe(false);
    expect(needsRulesAdoption(undefined, { ...LEGACY_SIM_RULES, revision: LEGACY_RULES_REVISION })).toBe(false);
    expect(needsRulesAdoption(undefined, FIXED_LEVEL_ONE)).toBe(true);
    expect(needsRulesAdoption(FIXED_LEVEL_ONE, FIXED_LEVEL_ONE)).toBe(false);
    expect(needsRulesAdoption(FIXED_LEVEL_ONE, LEGACY_SIM_RULES)).toBe(true);
  });

  it("standalone builds pin local settings under their local revision; no local file keeps today's rules", () => {
    const offline = GAME_SETTINGS_PRESETS.offlineSettlement;
    const rules = localSessionRules(offline)!;
    expect(rules.revision).toBe(localRulesRevision(offline));
    expect(isLocalRulesRevision(rules.revision)).toBe(true);
    expect(rules.catchUp).toBe("skip");
    expect(localSessionRules(undefined)).toBeUndefined();
    const sim = island();
    expect(sim.adoptGameRules(rules)).toBe(true);
    expect(needsRulesAdoption(sim.gameRules(), localSessionRules(offline))).toBe(false);
  });

  it("the map file's rules narrow the pinned rules through the one accessor", () => {
    const sim = createBalanceSimulation(48, 321, undefined, world => {
      world.scenario = { ...createMapScenario(), headquarters: undefined,
        rules: { experience: "none", features: { explorationExpeditions: "off", trade: "off" } } };
    });
    const rules = sim.effectiveGameRules();
    expect([rules.trade, rules.experience, rules.explorationExpeditions, rules.colonies])
      .toEqual([false, false, false, true]);
    expect(sim.adoptGameRules({ ...LEGACY_SIM_RULES, colonies: false, revision: "rev-c" })).toBe(true);
    expect(sim.effectiveGameRules()).toMatchObject({ colonies: false, trade: false });
  });
});
