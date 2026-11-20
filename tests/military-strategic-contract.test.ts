import { describe, expect, it, vi } from "vitest";

import {
  ARMY_REQUEST_SOLDIERS, MACRO_SCORES, MAX_INTENTS, RAID_RATIO
} from "../src/shared/balance/commander-director";
import { armyRequestsOf, COUNTER_TYPES } from "../src/shared/settlement/commander/army-requests";
import type { CommanderUnit } from "../src/shared/settlement/commander/commander-types";
import { replaceIntents } from "../src/shared/settlement/commander/director-intents";
import { type MacroInputs, orderScores, scoreMacros } from "../src/shared/settlement/commander/director-macros";
import { directorSaveError } from "../src/shared/settlement/commander/director-save";
import {
  type DirectorTraceRecord, setDirectorTraceSink
} from "../src/shared/settlement/commander/director-trace";
import {
  type DirectorFaction, type DirectorForce, DISMISSED_INTENT
} from "../src/shared/settlement/commander/director-types";
import {
  INTENT_MACROS, isStrategicIntent, sameIntent, type StrategicIntent
} from "../src/shared/settlement/commander/strategic-intents";
import type { MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";
import { stateHashOf } from "../tools/bench/military-a14-metrics";
import {
  fogRaidFixture, INTENT_CONTRACT_STRENGTH, intentContractFixture
} from "../tools/bench/military-a14-scenarios";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/**
 * The P4 contract between the enemy economy AI and the military director (A14 plan §5.4, lane A14-4c). Owned by
 * A14: the economy AI (economy plan P4) codes against exactly what these tests pin down.
 */
const COMPUTER = 1;
const AREA = { radius: 8, x: 64, z: 48 };
const attack = (uid: number, minStrength = 400): StrategicIntent =>
  ({ kind: "attack", minStrength, target: { kind: "site", uid } });

describe("strategic intents: shape and mapping", () => {
  it("maps intents to macros as plan §5.4 states", () => {
    expect(INTENT_MACROS).toEqual({ attack: "strike", defend: "defend", hold: "hold", raid: "raid",
      retreat: "withdraw", scout: "scout" });
  });

  it("accepts the six intent kinds and refuses malformed ones", () => {
    const valid: StrategicIntent[] = [{ area: AREA, kind: "defend", priority: 2 }, { area: AREA, kind: "hold" },
      attack(7), { kind: "raid", target: { area: AREA, kind: "area" } }, { kind: "scout" },
      { area: AREA, kind: "scout" }, { kind: "retreat" }];
    expect(valid.every(isStrategicIntent)).toBe(true);
    const broken = [undefined, { kind: "charge" }, { kind: "hold" }, { kind: "attack", target: { kind: "site" } },
      { kind: "attack", minStrength: -1, target: { kind: "site", uid: 1 } },
      { area: { radius: -1, x: 0, z: 0 }, kind: "hold" }, { area: { radius: 4, x: NaN, z: 0 }, kind: "scout" }];
    expect(broken.some(isStrategicIntent)).toBe(false);
  });

  it("treats a restated order as the same intent whatever its strength goal", () => {
    expect(sameIntent(attack(7, 400), attack(7, 900))).toBe(true);
    expect(sameIntent(attack(7), attack(8))).toBe(false);
    expect(sameIntent(attack(7), { kind: "raid", target: { kind: "site", uid: 7 } })).toBe(false);
    expect(sameIntent({ area: AREA, kind: "hold" }, { area: { ...AREA }, kind: "hold" })).toBe(true);
    expect(sameIntent({ kind: "scout" }, { area: AREA, kind: "scout" })).toBe(false);
  });
});

describe("setIntents receipts", () => {
  const entryWith = (forces: DirectorForce[] = []): DirectorFaction =>
    ({ faction: COMPUTER, forces, next: 10, nextForce: 2 });
  const force = (intent: number) => ({ intent, macro: "strike" }) as DirectorForce;
  const knows = (uid: number) => uid === 7;

  it("accepts a known site, rejects an unknown one and keeps at most four intents", () => {
    const entry = entryWith();
    const receipts = replaceIntents(entry, [attack(7), attack(9), { kind: "raid", target: { kind: "site", uid: 9 } },
      { area: AREA, kind: "hold" }, { kind: "scout" }], knows);
    expect(receipts.map(receipt => receipt.status))
      .toEqual(["accepted", "rejectedUnknownTarget", "rejectedUnknownTarget", "accepted", "failed"]);
    expect(receipts.map(receipt => receipt.index)).toEqual([0, 1, 2, 3, 4]);
    expect(entry.intents).toHaveLength(MAX_INTENTS);
  });

  it("refuses a list with a malformed intent as a whole and keeps the earlier intents", () => {
    const entry = entryWith();
    replaceIntents(entry, [attack(7)], knows);
    const receipts = replaceIntents(entry, [{ kind: "hold" } as StrategicIntent, attack(7)], knows);
    expect(receipts.map(receipt => receipt.status)).toEqual(["failed", "failed"]);
    expect(entry.intents?.map(state => state.intent.kind)).toEqual(["attack"]);
  });

  it("keeps a restated intent's state and force, and dismisses the force of a dropped intent", () => {
    const kept = force(0), dropped = force(1);
    const entry = entryWith();
    replaceIntents(entry, [attack(7), { area: AREA, kind: "hold" }], knows);
    entry.forces.push(kept, dropped);
    Object.assign(entry.intents![0]!, { force: 1, status: "underway", strength: 500 });
    const receipts = replaceIntents(entry, [{ kind: "scout" }, attack(7, 900)], knows);
    expect(receipts.map(receipt => receipt.status)).toEqual(["accepted", "underway"]);
    expect(entry.intents![1]).toMatchObject({ force: 1, status: "underway", strength: 500 });
    expect(entry.intents![1]!.intent).toMatchObject({ minStrength: 900 });
    expect(kept.intent).toBe(1);
    expect(dropped.intent).toBe(DISMISSED_INTENT);
  });
});

describe("an intent's force may only run the intent's macro", () => {
  const inputs = (patch: Partial<MacroInputs> = {}): MacroInputs => ({
    attackRatio: 1, brokenShare: 0, contact: false, current: "hold", goal: false, kind: "permit", members: 8,
    moraleMean: 70, raidRatio: RAID_RATIO, scoutable: true, spread: 3, start: 800, strength: 800, threat: false,
    ...patch
  });
  const ordered = (wanted: Parameters<typeof orderScores>[1], patch: Partial<MacroInputs> = {}) => {
    const value = inputs(patch);
    return orderScores(scoreMacros(value), wanted, value);
  };

  it("offers only the wanted macro, hold when its precondition fails", () => {
    const scout = ordered("scout", { target: { ratio: 5, tier: 3 } });
    expect([scout.scout, scout.strike, scout.raid]).toEqual([MACRO_SCORES.scout, -Infinity, -Infinity]);
    expect(ordered("strike").strike).toBe(-Infinity);
    expect(ordered("strike", { target: { ratio: .2, tier: 2 } }).strike).toBe(MACRO_SCORES.strike);
    expect(ordered("raid", { members: 12, target: { ratio: .2, tier: 2 } }).raid).toBe(MACRO_SCORES.raid);
    expect(ordered("defend").defend).toBe(-Infinity);
    expect(ordered("defend", { threat: true }).defend).toBe(MACRO_SCORES.defend);
    expect(ordered("hold", { threat: true, target: { ratio: 5, tier: 3 } }))
      .toMatchObject({ defend: -Infinity, hold: MACRO_SCORES.hold, raid: -Infinity, strike: -Infinity });
  });

  it("leaves withdraw and regroup to the director, and a retreat orders the withdrawal", () => {
    const beaten = ordered("strike", { current: "strike", strength: 100, target: { ratio: 1, tier: 2 } });
    expect(beaten.withdraw).toBe(MACRO_SCORES.withdraw);
    expect(ordered("strike", { current: "strike", spread: 20, target: { ratio: 1, tier: 2 } }).regroup)
      .toBe(MACRO_SCORES.regroup);
    expect(ordered("withdraw").withdraw).toBe(MACRO_SCORES.withdraw);
  });
});

describe("army requests", () => {
  const unit = (uid: number, type: MilitaryTroopType, faction = 0): CommanderUnit =>
    ({ faction, type, uid }) as CommanderUnit;
  const enemies = (type: MilitaryTroopType, count: number, from = 100) =>
    Array.from({ length: count }, (_, index) => unit(from + index, type));
  const requests = (perception: CommanderUnit[], shortfall = 0, lost = 0) =>
    armyRequestsOf({ faction: COMPUTER, lost, perception, shortfall });

  it("counters known riders with archers and swordsmen, known archers with swordsmen", () => {
    expect(COUNTER_TYPES).toMatchObject({ archer: "shield", cavalry: "archer", heavy: "archer", shield: "heavy" });
    expect(requests(enemies("cavalry", 6))).toEqual([
      { count: 2, priority: 2, reason: "counterComposition", type: "archer" },
      { count: 2, priority: 2, reason: "counterComposition", type: "shield" }]);
    expect(requests(enemies("archer", 8))).toEqual([
      { count: 2, priority: 2, reason: "counterComposition", type: "shield" }]);
  });

  it("asks for nothing against few or mixed known enemies, and never counts own soldiers", () => {
    expect(requests(enemies("archer", 3))).toEqual([]);
    expect(requests([...enemies("archer", 4), ...enemies("shield", 4, 200), ...enemies("heavy", 4, 300)]))
      .toEqual([]);
    expect(requests(Array.from({ length: 9 }, (_, index) => unit(index, "cavalry", COMPUTER)))).toEqual([]);
  });

  it("turns an intent's shortfall and losses into whole soldiers, most urgent first, eight in all", () => {
    expect(requests([], 250, 199)).toEqual([
      { count: 3, priority: 3, reason: "intentShortfall", type: "shield" },
      { count: 1, priority: 1, reason: "lossReplacement", type: "shield" }]);
    const capped = requests(enemies("cavalry", 20), 600, 900);
    expect(capped.map(request => [request.reason, request.type, request.count])).toEqual([
      ["intentShortfall", "archer", 6], ["counterComposition", "archer", 2]]);
    expect(capped.reduce((sum, request) => sum + request.count, 0)).toBe(ARMY_REQUEST_SOLDIERS);
  });
});

const traced = <T>(run: () => T) => {
  const records: DirectorTraceRecord[] = [];
  setDirectorTraceSink(record => { records.push({ ...record }); });
  try {
    return { records, result: run() };
  } finally {
    setDirectorTraceSink(null);
  }
};

const advance = (simulation: { update: (dt: number) => void }, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
};

describe("intent contract in the fixture", () => {
  it("rejects an attack on an unseen site, scouts it and attacks once it is known", () => {
    const live = intentContractFixture();
    const strategy = () => live.director().strategy;
    live.start();
    expect(live.receipts).toEqual([{ index: 0, status: "rejectedUnknownTarget" }]);
    expect(strategy().status(COMPUTER)).toEqual([{ index: 0, kind: "attack", status: "rejectedUnknownTarget",
      strength: 0 }]);
    const everySoldier = strategy().uncommitted(COMPUTER);
    expect(everySoldier).toHaveLength(12);

    const { records } = traced(() => advance(live.simulation, 1400));
    expect(records[0]?.macro).toBe("scout");
    const strikes = records.filter(record => record.macro === "strike");
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes.every(record => record.knownTargets > 0 && record.target === live.target)).toBe(true);
    expect(records.some(record => record.macro === "raid" || record.macro === "defend")).toBe(false);

    const [status] = strategy().status(COMPUTER);
    expect(status).toMatchObject({ force: 1, kind: "attack", status: "underway" });
    expect(status!.strength).toBeGreaterThanOrEqual(INTENT_CONTRACT_STRENGTH);
    // Eight swordsmen meet the strength goal: the four archers stay the economy's to garrison.
    expect(strategy().uncommitted(COMPUTER)).toEqual(everySoldier.slice(8));
    expect(strategy().setIntents(COMPUTER, [attack(live.target, INTENT_CONTRACT_STRENGTH)]))
      .toEqual([{ index: 0, status: "underway" }]);
  }, 120_000);

  it("saves the intents: a reload mid-scout continues to the same state", () => {
    const live = intentContractFixture(), reloaded = intentContractFixture();
    live.start();
    advance(live.simulation, 1000);
    reloaded.start();
    advance(reloaded.simulation, 300);
    const saved = reloaded.simulation.saveState();
    expect(saved.military?.combat?.director?.factions[0]?.intents?.[0]?.status).toBe("rejectedUnknownTarget");
    expect(reloaded.simulation.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
    advance(reloaded.simulation, 700);
    expect(stateHashOf(reloaded.simulation)).toBe(stateHashOf(live.simulation));
  }, 120_000);

  it("posts a hold force in its area, requests the attack's shortfall and withdraws everything on a retreat", () => {
    const live = intentContractFixture();
    const strategy = live.director().strategy;
    expect(strategy.setIntents(COMPUTER, [{ area: { radius: 2, x: 64, z: 46 }, kind: "hold" },
      { kind: "attack", minStrength: 2000, target: { area: { radius: 6, x: 40, z: 48 }, kind: "area" } }])
      .map(receipt => receipt.status)).toEqual(["accepted", "accepted"]);
    advance(live.simulation, 260);
    const [hold, strike] = strategy.status(COMPUTER);
    expect(hold).toMatchObject({ kind: "hold", status: "underway" });
    expect(strike).toMatchObject({ kind: "attack", status: "forming" });
    expect(hold!.strength).toBeGreaterThan(0);
    expect(strategy.uncommitted(COMPUTER)).toEqual([]);
    const requests = strategy.armyRequests(COMPUTER);
    expect(requests[0]).toMatchObject({ reason: "intentShortfall", type: "shield" });
    expect(requests.reduce((sum, request) => sum + request.count, 0)).toBeLessThanOrEqual(ARMY_REQUEST_SOLDIERS);
    const saved = live.simulation.saveState();
    expect(saved.military?.combat?.director?.factions[0]?.requests).toEqual(requests);

    expect(strategy.setIntents(COMPUTER, [{ kind: "retreat" }])).toEqual([{ index: 0, status: "accepted" }]);
    advance(live.simulation, 400);
    expect(strategy.status(COMPUTER)).toEqual([{ index: 0, kind: "retreat", status: "done", strength: 0 }]);
    expect(strategy.uncommitted(COMPUTER)).toHaveLength(12);
    expect(strategy.armyRequests(COMPUTER)).toEqual([]);
  }, 120_000);
});

describe("scout and raid intents in the fixture", () => {
  const NEAR = { radius: 4, x: 52, z: 48 };

  it("scouts a named area with one soldier and releases it when done", () => {
    const live = intentContractFixture();
    const { strategy } = live.director();
    strategy.setIntents(COMPUTER, [{ area: NEAR, kind: "scout" }]);
    advance(live.simulation, 200);
    expect(strategy.status(COMPUTER)).toMatchObject([{ force: 1, kind: "scout", status: "underway" }]);
    expect(strategy.uncommitted(COMPUTER)).toHaveLength(11);
    advance(live.simulation, 1400);
    expect(strategy.status(COMPUTER)).toEqual([{ index: 0, kind: "scout", status: "done", strength: 0 }]);
    expect(strategy.uncommitted(COMPUTER)).toHaveLength(12);
  }, 120_000);

  it("raids an area with at most six soldiers, then withdraws and reports done", () => {
    const live = intentContractFixture();
    const { strategy } = live.director();
    strategy.setIntents(COMPUTER, [{ kind: "raid", target: { area: NEAR, kind: "area" } }]);
    const { records } = traced(() => advance(live.simulation, 2400));
    expect(Math.max(...records.map(record => record.members))).toBe(6);
    const macros = records.map(record => record.macro).filter((macro, index, all) => macro !== all[index - 1]);
    expect(macros).toEqual(["raid", "withdraw"]);
    expect(strategy.status(COMPUTER)).toEqual([{ index: 0, kind: "raid", status: "done", strength: 0 }]);
    expect(strategy.uncommitted(COMPUTER)).toHaveLength(12);
  }, 120_000);
});

describe("without an economy AI the director acts on its defaults", () => {
  it("reports its own forces as default intents and saves no intent state", () => {
    const live = fogRaidFixture(30);
    live.start();
    advance(live.simulation, 200);
    const saved = live.simulation.saveState();
    const [faction] = saved.military!.combat!.director!.factions;
    expect(faction).not.toHaveProperty("intents");
    expect(faction).not.toHaveProperty("requests");
    expect(faction!.forces.every(force => !("intent" in force) && !("radius" in force))).toBe(true);
    const { strategy } = live.director();
    expect(strategy.status(COMPUTER)).toMatchObject([{ force: 1, index: 0, kind: "scout", status: "underway" }]);
    expect(strategy.armyRequests(COMPUTER)).toEqual([]);
    expect(strategy.status(2)).toEqual([]);
  }, 120_000);
});

describe("saved intents are validated", () => {
  const soldiers = new Set([5, 7]);
  const force = { home: { x: 1, z: 1 }, id: 1, intent: 0, kind: "permit", macro: "hold", members: [5, 7], since: 3,
    staging: { x: 2, z: 2 }, start: 200, task: 1 };
  const intents = [{ intent: { area: AREA, kind: "hold" }, status: "underway", strength: 200 }];
  const save = (patch: object = {}, forcePatch: object = {}) => ({ factions: [{ faction: 1,
    forces: [{ ...force, ...forcePatch }], intents, next: 10, nextForce: 2, ...patch }] });

  it("accepts intents with or without a force and rejects broken ones", () => {
    expect(directorSaveError(save(), soldiers)).toBeNull();
    expect(directorSaveError(save({ forces: [] }), soldiers)).toBeNull();
    expect(directorSaveError(save({ forces: [], intents: undefined }), soldiers)).not.toBeNull();
    expect(directorSaveError(save({}, { intent: 1 }), soldiers)).not.toBeNull();
    expect(directorSaveError(save({}, { intent: DISMISSED_INTENT }), soldiers)).toBeNull();
    expect(directorSaveError(save({ intents: [{ ...intents[0], status: "lost" }] }), soldiers)).not.toBeNull();
    expect(directorSaveError(save({ intents: Array(5).fill(intents[0]) }), soldiers)).not.toBeNull();
    expect(directorSaveError(save({ requests: [{ count: 2, priority: 3, reason: "intentShortfall",
      type: "cavalry" }] }), soldiers)).not.toBeNull();
    expect(directorSaveError(save({ requests: [{ count: 2, priority: 3, reason: "intentShortfall",
      type: "shield" }] }), soldiers)).toBeNull();
  });
});
