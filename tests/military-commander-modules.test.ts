import { afterEach, describe, expect, it } from "vitest";

import { COMMANDER_PROFILES, COMMANDER_SEARCH_RADIUS } from "../src/shared/balance/commander-profiles";
import { COMMANDER_WEIGHTS, DECISION_INTERVAL } from "../src/shared/balance/military";
import { rememberDecision } from "../src/shared/settlement/commander/commander-squad-memory";
import { createSquadFormer } from "../src/shared/settlement/commander/commander-squads";
import {
  type CommanderTraceRecord,
  setCommanderTraceSink
} from "../src/shared/settlement/commander/commander-trace";
import type { CommanderProfile, CommanderUnit } from "../src/shared/settlement/commander/commander-types";
import { createMilitaryCommander, formSquads } from "../src/shared/settlement/military-commander";

const SQUAD_LINK = 6;

afterEach(() => setCommanderTraceSink(null));

const fieldUnit = (uid: number, faction: number, x: number, z: number): CommanderUnit => ({
  busy: false,
  faction,
  fighting: false,
  health: 1,
  home: { x, z },
  marching: false,
  rank: 0,
  type: "shield",
  uid,
  x,
  z
});

/** The squad assembly as it was before A14-0 (string-keyed buckets): the reference for the numeric one. */
const referenceSquads = (units: readonly CommanderUnit[]) => {
  const sorted = [...units].sort((a, b) => a.uid - b.uid),
    squads: number[][] = [];
  const buckets = new Map<string, Map<number, CommanderUnit>>(),
    remaining = new Set(sorted.map((unit) => unit.uid));
  const key = (unit: CommanderUnit, dx = 0, dz = 0) =>
    `${Math.floor(unit.x / SQUAD_LINK) + dx},${Math.floor(unit.z / SQUAD_LINK) + dz}`;
  for (const unit of sorted) {
    const bucket = buckets.get(key(unit)) ?? new Map<number, CommanderUnit>();
    buckets.set(key(unit), bucket.set(unit.uid, unit));
  }
  const take = (unit: CommanderUnit) => {
    remaining.delete(unit.uid);
    buckets.get(key(unit))?.delete(unit.uid);
  };
  for (const first of sorted) {
    if (!remaining.has(first.uid)) continue;
    const squad = [first];
    take(first);
    for (let index = 0; index < squad.length; index++) {
      const centre = squad[index]!;
      const nearby: CommanderUnit[] = [];
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          for (const other of buckets.get(key(centre, dx, dz))?.values() ?? [])
            if (Math.hypot(other.x - centre.x, other.z - centre.z) <= SQUAD_LINK) nearby.push(other);
      nearby.sort((a, b) => a.uid - b.uid);
      for (const other of nearby) {
        take(other);
        squad.push(other);
      }
    }
    squads.push(squad.map((unit) => unit.uid));
  }
  return squads;
};

/** A repeatable scatter of soldiers in shuffled uid order (no `Math.random`). */
const scatter = (count: number, seed: number, extent: number, origin: number) => {
  let state = seed;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const units = Array.from({ length: count }, (_, index) =>
    fieldUnit(index + 1, 1, origin + next() * extent, origin + next() * extent)
  );
  return units.sort(() => next() - 0.5);
};

const uidsOf = (squads: readonly (readonly CommanderUnit[])[]) =>
  squads.map((squad) => squad.map((unit) => unit.uid));

describe("commander squad forming with numeric buckets", () => {
  it.each([
    { count: 1, extent: 10, origin: 0, seed: 1 },
    { count: 40, extent: 30, origin: 0, seed: 2 },
    { count: 128, extent: 96, origin: 0, seed: 3 },
    { count: 128, extent: 40, origin: -20, seed: 4 },
    { count: 300, extent: 200, origin: 100, seed: 5 }
  ])("forms the squads of the string-bucket reference: $count soldiers, seed $seed", (field) => {
    const units = scatter(field.count, field.seed, field.extent, field.origin);
    expect(uidsOf(formSquads(units))).toEqual(referenceSquads(units));
  });

  it("gives the same squads when its arrays are reused for a smaller and a larger field", () => {
    const former = createSquadFormer();
    for (const field of [scatter(200, 6, 120, 0), scatter(12, 7, 20, 300), [], scatter(260, 8, 60, -40)])
      expect(uidsOf(former(field))).toEqual(referenceSquads(field));
  });
});

describe("commander squad memory", () => {
  it("keeps the same memory object while the decision stands, and replaces it when it changes", () => {
    const standing = { action: "attack" as const, target: { x: 10, z: 10 } };
    expect(rememberDecision(standing, "attack", { x: 12, z: 10 })).toBe(standing);
    expect(rememberDecision(standing, "attack", undefined)).toBe(standing);
    expect(rememberDecision(standing, "attack", { x: 20, z: 10 })).toEqual({
      action: "attack",
      target: { x: 20, z: 10 }
    });
    expect(rememberDecision(standing, "defend", undefined)).toEqual({ action: "defend", target: undefined });
    expect(rememberDecision(undefined, "regroup", { x: 1, z: 2 })).toEqual({
      action: "regroup",
      target: { x: 1, z: 2 }
    });
  });
});

interface SentOrder {
  faction: number;
  ids: number[];
  order: string;
}

/** A bare commander over hand-made units; `profile` and the sent orders are observable. */
const commanderOver = (units: CommanderUnit[], profile: (faction: number) => CommanderProfile) => {
  const orders: SentOrder[] = [];
  const commander = createMilitaryCommander({
    cellsX: 96,
    cellsZ: 96,
    command: (ids, _point, faction, order) => orders.push({ faction, ids: [...ids], order }) > 0,
    isClear: () => true,
    profile,
    units: () => units
  });
  return { commander, orders };
};

describe("commander profile per faction", () => {
  it("equals today's weights on every level and today's interval on medium, with one search radius", () => {
    for (const level of ["easy", "medium", "hard"] as const)
      expect(COMMANDER_PROFILES[level].weights).toBe(COMMANDER_WEIGHTS[level]);
    expect(COMMANDER_PROFILES.medium.decisionInterval).toBe(DECISION_INTERVAL);
    // A14-2: focus, danger and morale use are weighed per level (plan §7); medium weighs them 1.
    expect(COMMANDER_PROFILES.medium).toMatchObject({ dangerWeight: 1, focusWeight: 1, moraleUse: 1 });
    expect(COMMANDER_SEARCH_RADIUS).toBe(COMMANDER_WEIGHTS.hard.attackRadius);
  });

  it("scores each faction with its own weights: hard presses on where easy holds back", () => {
    // Two mirrored fields far apart: six soldiers 15 tiles from a stronger enemy group.
    const field = (faction: number, uid: number, z: number) => [
      ...Array.from({ length: 6 }, (_, index) => fieldUnit(uid + index, faction, 20 + index, z)),
      ...Array.from({ length: 7 }, (_, index) => fieldUnit(uid + 50 + index, 0, 37.5 + index * 0.5, z))
    ];
    const units = [...field(1, 100, 10), ...field(2, 200, 80)];
    const asked: number[] = [];
    const { commander, orders } = commanderOver(units, (faction) => {
      asked.push(faction);
      return faction === 1 ? COMMANDER_PROFILES.easy : COMMANDER_PROFILES.hard;
    });
    commander.update(DECISION_INTERVAL);
    expect(orders).toEqual([{ faction: 2, ids: [200, 201, 202, 203, 204, 205], order: "attackMove" }]);
    // Per faction: once for the cycle's interval and once for the decision's weights.
    expect(asked.filter((faction) => faction === 1)).toHaveLength(2);
    expect(asked.filter((faction) => faction === 2)).toHaveLength(2);
  });

  it("decides at the interval of the faction's profile", () => {
    const quick: CommanderProfile = { ...COMMANDER_PROFILES.medium, decisionInterval: 0.5 };
    const records: CommanderTraceRecord[] = [];
    setCommanderTraceSink((record) => records.push(record));
    const { commander } = commanderOver(
      [fieldUnit(1, 4, 10, 10), fieldUnit(2, 8, 60, 60)],
      (faction) => (faction === 4 ? quick : COMMANDER_PROFILES.medium)
    );
    // Factions 4 and 8 both start at clock 0 (slot 0): three seconds are six quick and two medium decisions.
    for (let tick = 0; tick < 24; tick++) commander.update(0.125);
    expect(records.filter((record) => record.faction === 4)).toHaveLength(6);
    expect(records.filter((record) => record.faction === 8)).toHaveLength(2);
  });
});

describe("commander decision trace", () => {
  const battle = () => {
    const units = [fieldUnit(1, 1, 24, 20), fieldUnit(2, 1, 22, 20), fieldUnit(100, 0, 30, 20)];
    return commanderOver(units, () => COMMANDER_PROFILES.medium);
  };

  it("reports every squad decision with its inputs and what became of the order", () => {
    const records: CommanderTraceRecord[] = [];
    setCommanderTraceSink((record) => records.push(record));
    const { commander, orders } = battle();
    commander.update(DECISION_INTERVAL);
    commander.update(DECISION_INTERVAL);
    expect(orders).toHaveLength(1);
    expect(records.map((record) => record.outcome)).toEqual(["issued", "unchanged"]);
    expect(records[0]).toMatchObject({
      action: "attack",
      faction: 1,
      members: 2,
      order: "attackMove",
      ordered: 2,
      resuming: false,
      role: "front",
      squad: 1,
      troop: "shield"
    });
    // A14-1: the front's point lies on the contact line, 1-5 tiles short of the enemy.
    expect(records[0]!.target!.z).toBeCloseTo(20);
    expect(records[0]!.target!.x).toBeGreaterThanOrEqual(25);
    expect(records[0]!.target!.x).toBeLessThanOrEqual(29);
    expect(records[0]!.view.enemyDistance).toBeCloseTo(7);
    expect(records[0]!.scores.attack).toBeGreaterThan(records[0]!.scores.defend);
  });

  it("changes nothing the commander saves or orders, and reports nothing while off", () => {
    const records: CommanderTraceRecord[] = [];
    const traced = battle(),
      plain = battle();
    setCommanderTraceSink((record) => records.push(record));
    traced.commander.update(DECISION_INTERVAL);
    setCommanderTraceSink(null);
    plain.commander.update(DECISION_INTERVAL);
    expect(records).toHaveLength(1);
    expect(traced.orders).toEqual(plain.orders);
    expect(traced.commander.save()).toEqual(plain.commander.save());
  });
});
