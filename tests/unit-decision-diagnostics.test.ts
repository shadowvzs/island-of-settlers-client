import { describe, expect, it } from "vitest";

import type { MilitaryCombatant } from "../src/shared/settlement/military-combat-rules";
import type { NavigationRecoveryState } from "../src/shared/settlement/settlement-navigation-recovery";
import type {
  ProductionRule,
  SettlementActor,
  SettlementBuilding,
  SettlementContext
} from "../src/shared/settlement/settlement-types";
import {
  emptyUnitDecisionReasonCounts,
  resolveUnitDecisionReason,
  UNIT_DECISION_REASON_CODES,
  unitDecisionDiagnostics,
  type UnitDecisionFacts,
  unitDecisionSnapshot} from "../src/shared/settlement/unit-decision-diagnostics";

const actor = (overrides: Partial<SettlementActor> = {}): SettlementActor => ({
  action: "idle", animationTime: 0, building: 10, home: 1, job: "Carpenter", path: [], pathIndex: 0,
  phase: "inside", timer: 0, uid: 7, visible: true, ware: null, x: 2, y: 0, yaw: 0, z: 2,
  ...overrides
}) as SettlementActor;

const building = (overrides: Partial<SettlementBuilding> = {}): SettlementBuilding => ({
  access: { x: 2, z: 2 }, accepts: {}, construction: 1, cycle: 0, depth: 2, door: 0,
  doorThreshold: { x: 2, z: 2 }, hasDoor: true, incoming: {}, input: {}, inventory: {},
  output: {}, required: {}, rotation: 0, selected: false, status: "", typeId: 33, uid: 10,
  width: 2, worker: 7, workerApproach: { x: 2, z: 2 }, working: false, x: 2, y: 0, z: 2,
  ...overrides
}) as SettlementBuilding;

const rule = (overrides: Partial<ProductionRule> = {}): ProductionRule => ({
  inputs: [], job: "Carpenter", outputs: [], seconds: 10, ...overrides
});

const recovery = (overrides: Partial<NavigationRecoveryState> = {}): NavigationRecoveryState => ({
  attempts: 0, blocked: false, elapsed: 0, notified: false, revision: "1/1/1", task: "work/1/1",
  ...overrides
});

const reasonOf = (facts: Partial<UnitDecisionFacts> & { actor?: SettlementActor } = {}) =>
  resolveUnitDecisionReason({ actor: actor(facts.actor), ...facts });

const soldier = (overrides: Partial<MilitaryCombatant> = {}): MilitaryCombatant => ({
  cooldown: 0, faction: 0, hp: 10, type: "shield", ...overrides
});

describe("unit decision reasons", () => {
  it("reports no work when an outdoor search found no reachable target", () => {
    expect(reasonOf({ actor: actor({ phase: "workSearchWait" }),
      building: building({ status: "Waiting for reachable resource" }),
      rule: rule({ outdoor: "tree" }) })).toBe("no-work");
  });

  it("reports no path for a blocked retry phase, a proven route failure or a removed bridge", () => {
    expect(reasonOf({ actor: actor({ phase: "returnBlocked" }) })).toBe("no-path");
    expect(reasonOf({ actor: actor({ navigationRecovery: recovery({ blocked: true }) }) })).toBe("no-path");
    expect(reasonOf({ actor: actor({ bridgeWait: { destination: { x: 4, z: 4 } } }) })).toBe("no-path");
  });

  it("reports waiting for ware when a production input is missing", () => {
    expect(reasonOf({ actor: actor(), building: building({ status: "Waiting for inputs" }),
      rule: rule({ inputs: ["logs"] }) })).toBe("waiting-for-ware");
    expect(reasonOf({ actor: actor(), building: building(), rule: rule({ inputs: ["logs", "water"] }) }))
      .toBe("waiting-for-ware");
  });

  it("accepts an alternative-food input whenever any listed food is on the bay", () => {
    expect(reasonOf({ actor: actor(), building: building({ input: { meat: 1 } }),
      rule: rule({ alternativeFood: true, inputs: ["fish", "meat", "bread"] }) }))
      .not.toBe("waiting-for-ware");
  });

  it("reports waiting for storage space when the output shelf is full", () => {
    expect(reasonOf({ actor: actor(), building: building({ output: { planks: 6 } }),
      rule: rule({ outputs: ["planks"] }) })).toBe("waiting-for-storage");
  });

  it("reports blocked door and queued waits separately", () => {
    expect(reasonOf({ actor: actor({ phase: "workerRestWait" }) })).toBe("blocked-door");
    expect(reasonOf({ actor: actor({ phase: "deliver",
      queueTarget: { x: 3, z: 3 } }) })).toBe("queued");
  });

  it("reports a missing tool from the shop and home storage state", () => {
    expect(reasonOf({ actor: actor({ tool: undefined }), building: building(),
      home: building({ inventory: {}, uid: 1 }), rule: rule({ tool: "axe" }) })).toBe("tool-missing");
    expect(reasonOf({ actor: actor(), building: building(),
      home: building({ inventory: { axe: 1 }, uid: 1 }), rule: rule({ tool: "axe" }) }))
      .not.toBe("tool-missing");
  });

  it("reports a paused building before any stock gate", () => {
    expect(reasonOf({ actor: actor(), building: building({ productionPaused: true }),
      rule: rule({ inputs: ["logs"] }) })).toBe("building-paused");
  });

  it("reports a builder waiting for supplies or for safe site access", () => {
    const builder = actor({ job: "Builder", phase: "construct" });
    expect(reasonOf({ actor: builder,
      building: building({ construction: 0, status: "Waiting for construction supplies" }) }))
      .toBe("waiting-for-ware");
    expect(reasonOf({ actor: builder,
      building: building({ construction: 0, status: "Waiting for safe building access" }) }))
      .toBe("no-path");
  });

  it("reports resting, working, walking, waiting and inactive from the existing handler", () => {
    expect(reasonOf({ actor: actor({ phase: "rest" }) })).toBe("resting");
    expect(reasonOf({ actor: actor({ action: "work", phase: "work" }) })).toBe("working");
    expect(reasonOf({ actor: actor({ action: "walk", phase: "outbound" }) })).toBe("walking");
    expect(reasonOf({ actor: actor({ phase: "inside" }) })).toBe("waiting");
    expect(reasonOf({ actor: actor({ phase: "retired" }) })).toBe("inactive");
  });

  it("reports no claim for an idle carrier without a delivery or trip", () => {
    expect(reasonOf({ actor: actor({ delivery: undefined, job: "Carrier", phase: "home" }) }))
      .toBe("no-claim");
  });

  it("reports exhausted search budget after repeated stuck repairs", () => {
    expect(reasonOf({ actor: actor({ navigationRecovery: recovery({ attempts: 2 }),
      phase: "outbound" }) })).toBe("search-budget");
  });

  it("reports fighting, retreating and commander orders from combat state", () => {
    expect(reasonOf({ actor: actor({ phase: "militaryField" }),
      soldier: soldier({ target: 42 }) })).toBe("fighting");
    expect(reasonOf({ actor: actor({ phase: "militaryField" }),
      soldier: soldier({ order: "retreat" }) })).toBe("retreating");
    expect(reasonOf({ actor: actor({ phase: "militaryField" }),
      soldier: soldier({ destination: { x: 8, z: 8 }, order: "attackMove" }) })).toBe("commander-order");
  });

  it("derives one actor's diagnostics through the simulation-shaped context", () => {
    const site = building({ output: { planks: 6 } });
    const context = { actors: [], buildings: [site], playerNation: "roman" } as unknown as SettlementContext;
    const diagnostics = unitDecisionDiagnostics(context, actor({ tool: "saw" }));
    expect(diagnostics).toMatchObject({ actor: 7, phase: "inside", reason: "waiting-for-storage" });
  });

  it("counts reasons and bounds the development-overlay label list", () => {
    const resting = actor({ phase: "rest", uid: 8 });
    const context = { actors: [actor(), resting], buildings: [building({ construction: 0 })],
      playerNation: "roman" } as unknown as SettlementContext;
    const snapshot = unitDecisionSnapshot(context, 1, () => undefined);
    expect(snapshot.visible).toBe(2);
    expect(snapshot.units).toHaveLength(1);
    const counted = Object.values(snapshot.counts).reduce((sum, count) => sum + count, 0);
    expect(counted).toBe(2);
    expect(snapshot.counts.resting).toBe(1);
  });

  it("keeps every reason code represented in the shared ordering and empty counts", () => {
    expect(new Set(UNIT_DECISION_REASON_CODES).size).toBe(UNIT_DECISION_REASON_CODES.length);
    expect(Object.keys(emptyUnitDecisionReasonCounts()).sort())
      .toEqual([...UNIT_DECISION_REASON_CODES].sort());
  });

  it("never mutates the actor or building it inspects", () => {
    const inspectedActor = actor();
    const inspectedBuilding = building({ output: { planks: 6 }, productionPaused: true });
    const before = JSON.stringify([inspectedActor, inspectedBuilding]);
    expect(reasonOf({ actor: inspectedActor, building: inspectedBuilding,
      rule: rule({ outputs: ["planks"] }) })).toBe("building-paused");
    expect(JSON.stringify([inspectedActor, inspectedBuilding])).toBe(before);
  });
});
