import { afterEach, describe, expect, it } from "vitest";

import { COMMANDER_PROFILES } from "../src/shared/balance/commander-profiles";
import { ATTACK_BANDS, ROLE_POSITION_WEIGHTS } from "../src/shared/balance/commander-roles";
import { DECISION_INTERVAL } from "../src/shared/balance/military";
import {
  type CandidateSample,
  createCandidateBuffer,
  MAX_CANDIDATES,
  type PositionFrame,
  scoreCandidate,
  writeCandidates
} from "../src/shared/settlement/commander/commander-positions";
import { assignRoles, createRoleGroupSplitter } from "../src/shared/settlement/commander/commander-roles";
import {
  type CommanderTraceRecord,
  setCommanderTraceSink
} from "../src/shared/settlement/commander/commander-trace";
import type {
  CommanderRole,
  CommanderUnit,
  MilitaryCommanderOptions,
  RoleGroupMemory
} from "../src/shared/settlement/commander/commander-types";
import { militaryAiSaveError } from "../src/shared/settlement/military-ai-save-validation";
import type { MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";
import { createMilitaryCommander } from "../src/shared/settlement/military-commander";
import type { MilitaryOrder } from "../src/shared/settlement/military-targeting";
import type { SettlementPoint } from "../src/shared/settlement/settlement-types";

/** A14-1 role groups and tactical positions (plan §3.1-§3.2): pure scorers, roles, orders and saves. */

afterEach(() => setCommanderTraceSink(null));

const unit = (
  uid: number,
  faction: number,
  x: number,
  z: number,
  type: MilitaryTroopType = "shield",
  health = 1
): CommanderUnit => ({
  busy: false,
  faction,
  fighting: false,
  health,
  home: { x, z },
  marching: false,
  rank: 0,
  type,
  uid,
  x,
  z
});

interface SentOrder {
  ids: number[];
  order: MilitaryOrder;
  point: SettlementPoint;
}

const commanderOver = (units: CommanderUnit[], extra: Partial<MilitaryCommanderOptions> = {}) => {
  const orders: SentOrder[] = [];
  const commander = createMilitaryCommander({
    cellsX: 96,
    cellsZ: 96,
    command: (ids, point, _faction, order) => orders.push({ ids: [...ids], order, point }) > 0,
    isClear: () => true,
    profile: () => COMMANDER_PROFILES.medium,
    units: () => units,
    ...extra
  });
  return { commander, decide: () => commander.update(DECISION_INTERVAL), orders };
};

const sample = (overrides: Partial<CandidateSample>): CandidateSample => ({
  alertExposure: 0,
  enemy: 0,
  heightGain: 0,
  nearPrevious: false,
  own: 0,
  reach: 0,
  risk: 0,
  travel: 0,
  usesHeight: false,
  ...overrides
});

describe("candidate score", () => {
  const front = ROLE_POSITION_WEIGHTS.front,
    band = ATTACK_BANDS.front;
  it.each([
    ["an empty cell out of band", sample({ reach: 20 }), 0],
    ["the role band", sample({ reach: 3 }), front.reach],
    ["own ground (influence share)", sample({ own: 3, reach: 20 }), front.support * 0.75],
    ["enemy ground", sample({ enemy: 3, reach: 20 }), -front.exposure * 0.75],
    ["height counted up to the cap", sample({ heightGain: 5, reach: 20, usesHeight: true }), front.height * 3],
    ["height ignored by the role", sample({ heightGain: 2, reach: 20 }), 0],
    ["travel per influence cell", sample({ reach: 20, travel: 8 }), -front.travel * 2],
    ["the previous point", sample({ nearPrevious: true, reach: 20 }), front.commitment],
    ["unseen fire on the current place", sample({ alertExposure: 1, reach: 20 }), -front.exposure]
  ])("%s", (_name, input, expected) => {
    expect(scoreCandidate(input, front, band)).toBeCloseTo(expected);
  });

  it("counts the flank risk on the way", () => {
    const flank = ROLE_POSITION_WEIGHTS.flank;
    expect(scoreCandidate(sample({ reach: 20, risk: 0.5 }), flank, ATTACK_BANDS.flank)).toBeCloseTo(
      -flank.flankRisk * 0.5
    );
  });
});

describe("candidates", () => {
  const frame: PositionFrame = {
    dirX: 1,
    dirZ: 0,
    enemyCentre: { x: 40, z: 20 },
    enemyHeight: 0,
    flankDepth: 0,
    flankTarget: { x: 40, z: 20 },
    frontDistance: 0,
    home: { x: 10, z: 20 },
    lateralMax: 0,
    lateralMin: 0,
    mode: "attack",
    reference: { x: 40, z: 20 }
  };
  const buffer = createCandidateBuffer();
  const pointsOf = (role: CommanderRole, previous?: SettlementPoint) => {
    writeCandidates(buffer, frame, role, { x: 30, z: 20 }, previous);
    return Array.from({ length: buffer.count }, (_, index) => ({
      x: buffer.xz[index * 2]!,
      z: buffer.xz[index * 2 + 1]!
    }));
  };

  it("keeps the current place and the previous point first, never more than 12", () => {
    // An attacking flank never keeps its current place (it must go round the line).
    expect(pointsOf("flank", { x: 31, z: 22 })[0]).toEqual({ x: 31, z: 22 });
    for (const role of ["front", "overwatch", "reserve"] as const) {
      const points = pointsOf(role, { x: 31, z: 22 });
      expect(points.length).toBeLessThanOrEqual(MAX_CANDIDATES);
      expect(points.slice(0, 2)).toEqual([
        { x: 30, z: 20 },
        { x: 31, z: 22 }
      ]);
    }
  });

  it("lays the front on the contact line, overwatch in bow band behind it, flank to the sides", () => {
    expect(pointsOf("front").slice(1)).toEqual([
      { x: 35, z: 20 },
      { x: 37, z: 20 },
      { x: 39, z: 20 }
    ]);
    for (const point of pointsOf("overwatch").slice(1)) {
      expect(Math.hypot(point.x - 40, point.z - 20)).toBeCloseTo(7.5);
      expect(point.x).toBeLessThan(40);
    }
    expect(pointsOf("flank")).toEqual([
      { x: 43, z: 28 },
      { x: 43, z: 12 }
    ]);
    // The reserve steps straight back behind the group (at x 30, 10 tiles from the enemy centre).
    expect(pointsOf("reserve").slice(1)).toEqual([{ x: 30, z: 20 }, { x: 26, z: 20 }]);
  });

  it("sends the flank round the ends of a wide enemy line, level with its archers", () => {
    Object.assign(frame, { flankDepth: 4, flankTarget: { x: 44, z: 20 }, lateralMax: 7, lateralMin: -6 });
    expect(pointsOf("flank")).toEqual([
      { x: 47, z: 30 },
      { x: 47, z: 11 }
    ]);
    Object.assign(frame, { flankDepth: 0, flankTarget: { x: 40, z: 20 }, lateralMax: 0, lateralMin: 0 });
  });
});

describe("role assignment", () => {
  const split = createRoleGroupSplitter();
  const rolesOf = (squad: CommanderUnit[], previous?: RoleGroupMemory[]) => {
    const groups = split(squad);
    assignRoles(groups, previous);
    return Object.fromEntries(groups.map((group) => [group.type, group.role]));
  };

  it("gives each troop type its role; a squad of one type keeps it", () => {
    expect(rolesOf([unit(1, 1, 0, 0, "archer"), unit(2, 1, 1, 0, "cavalry"), unit(3, 1, 2, 0)])).toEqual({
      archer: "overwatch",
      cavalry: "flank",
      shield: "front"
    });
    expect(rolesOf([unit(1, 1, 0, 0, "heavy", 0.2)])).toEqual({ heavy: "front" });
  });

  it("sends the swordsmen to the flank beside an axeman front, else they hold the front", () => {
    const squad = [unit(1, 1, 0, 0), unit(2, 1, 1, 0, "heavy"), unit(3, 1, 2, 0, "heavy")];
    expect(rolesOf(squad)).toEqual({ heavy: "front", shield: "flank" });
    expect(rolesOf([...squad, unit(4, 1, 3, 0, "archer")])).toEqual({
      archer: "overwatch",
      heavy: "front",
      shield: "flank"
    });
    // Swordsmen outnumbering the axemen hold the front with them; the weaker front stands in reserve.
    expect(rolesOf([unit(1, 1, 0, 0), unit(2, 1, 1, 0), unit(3, 1, 2, 0, "heavy")])).toEqual({
      heavy: "reserve",
      shield: "front"
    });
    // Wounded axemen stand in reserve: the swordsmen hold the front instead.
    expect(rolesOf([unit(1, 1, 0, 0), unit(3, 1, 2, 0, "heavy", 0.3)])).toEqual({ heavy: "reserve", shield: "front" });
  });

  it("sends a shaken group to the reserve and keeps a standing reserve within commitment", () => {
    const shaken = (uid: number, type: MilitaryTroopType, morale: number) =>
      ({ ...unit(uid, 1, uid, 0, type), morale });
    expect(rolesOf([shaken(1, "shield", 70), shaken(2, "archer", 30)]))
      .toEqual({ archer: "reserve", shield: "front" });
    expect(rolesOf([shaken(1, "shield", 70), shaken(2, "archer", 40)]))
      .toEqual({ archer: "overwatch", shield: "front" });
    expect(rolesOf([shaken(1, "shield", 70), shaken(2, "archer", 40)], [{ age: 0, role: "reserve", type: "archer" }]))
      .toEqual({ archer: "reserve", shield: "front" });
  });

  it("sends wounded groups to the reserve while another group still fights", () => {
    expect(rolesOf([unit(1, 1, 0, 0, "archer", 0.3), unit(2, 1, 1, 0)])).toEqual({
      archer: "reserve",
      shield: "front"
    });
    expect(rolesOf([unit(1, 1, 0, 0, "archer", 0.3), unit(2, 1, 1, 0, "shield", 0.2)])).toEqual({
      archer: "overwatch",
      shield: "front"
    });
  });
});

describe("role-group orders", () => {
  /** A mixed computer squad at x 20 and a weaker player group at x 27 (in contact: the flank launches). */
  const mixedBattle = () => [
    unit(1, 1, 20, 20),
    unit(2, 1, 20, 21),
    unit(3, 1, 19, 20, "archer"),
    unit(4, 1, 19, 21, "archer"),
    unit(5, 1, 21, 23, "heavy"),
    unit(6, 1, 21, 22, "heavy"),
    unit(100, 0, 27, 20),
    unit(101, 0, 27, 21)
  ];

  it("sends each role group to its own point with its own order, once", () => {
    const records: CommanderTraceRecord[] = [];
    setCommanderTraceSink((record) => records.push(record));
    const { decide, orders } = commanderOver(mixedBattle());
    decide();
    expect(records.map((record) => [record.troop, record.role, record.outcome])).toEqual([
      ["shield", "flank", "issued"],
      ["heavy", "front", "issued"],
      ["archer", "overwatch", "issued"]
    ]);
    const [flank, front, overwatch] = orders;
    expect(flank).toMatchObject({ ids: [1, 2], order: "move" });
    expect(front).toMatchObject({ ids: [5, 6], order: "attackMove" });
    expect(overwatch).toMatchObject({ ids: [3, 4], order: "attackMove" });
    // The archers stand further from the enemy than the front; the swordsmen leave the line to the side.
    expect(27 - overwatch!.point.x).toBeGreaterThan(27 - front!.point.x);
    expect(Math.abs(flank!.point.z - 20.5)).toBeGreaterThan(4);
    decide();
    // The swordsmen are no longer walking (these test soldiers never move): the flank strikes, the rest hold.
    expect(orders).toHaveLength(4);
    expect(orders[3]).toMatchObject({ ids: [1, 2], order: "attackMove" });
  });

  it("prefers higher ground for the overwatch", () => {
    const lowOrders = commanderOver(mixedBattle());
    lowOrders.decide();
    const ridge = (point: SettlementPoint) => (point.z < 18 ? 3 : 0);
    const highOrders = commanderOver(mixedBattle(), { heightAt: ridge });
    highOrders.decide();
    const overwatchOf = (orders: SentOrder[]) => orders.find((order) => order.ids.includes(3))!.point;
    expect(overwatchOf(lowOrders.orders).z).toBeGreaterThanOrEqual(18);
    expect(overwatchOf(highOrders.orders).z).toBeLessThan(18);
  });

  it("leaves its place when shot at by an enemy it knows only by the hit alert", () => {
    // Archers already in bow band: they stay where they stand, unless that place is under unseen fire.
    const archersInBand = () => [
      unit(3, 1, 32.5, 20, "archer"),
      unit(4, 1, 32.5, 21, "archer"),
      unit(100, 0, 40, 20),
      unit(101, 0, 40, 21)
    ];
    const calm = commanderOver(archersInBand());
    calm.decide();
    expect(calm.orders[0]!.point).toEqual({ x: 32.5, z: 20.5 });
    const shot = commanderOver(archersInBand(), { knowsByAlertOnly: (_faction, enemy) => enemy.uid === 100 });
    shot.decide();
    expect(shot.orders[0]!.point).not.toEqual({ x: 32.5, z: 20.5 });
  });

  it("saves the role groups, validates them and decides the same after a reload", () => {
    const units = mixedBattle();
    const first = commanderOver(units);
    first.decide();
    const saved = first.commander.save();
    const memory = saved.memories[0]![1][0]![1];
    expect(memory.groups?.map((group) => [group.type, group.role])).toEqual([
      ["shield", "flank"],
      ["heavy", "front"],
      ["archer", "overwatch"]
    ]);
    const soldierIds = new Set(units.map((entry) => entry.uid));
    expect(militaryAiSaveError(undefined, JSON.parse(JSON.stringify(saved)), soldierIds)).toBeNull();
    const broken = structuredClone(saved);
    (broken.memories[0]![1][0]![1] as { groups: unknown }).groups = [{ age: 0, role: "scout", type: "shield" }];
    expect(militaryAiSaveError(undefined, broken, soldierIds)).not.toBeNull();

    const second = commanderOver(units);
    second.commander.restore(structuredClone(saved));
    units.find((entry) => entry.uid === 100)!.x = 26;
    first.decide();
    second.decide();
    expect(second.orders).toEqual(first.orders.slice(3));
    expect(second.commander.save()).toEqual(first.commander.save());
  });
});
