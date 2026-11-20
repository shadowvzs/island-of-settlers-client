import { describe, expect, it } from "vitest";

import { COMMANDER_PROFILES } from "../src/shared/balance/commander-profiles";
import { ORDER_HOLD_DECISIONS } from "../src/shared/balance/commander-roles";
import { COMMANDER_WEIGHTS, DECISION_INTERVAL } from "../src/shared/balance/military";
import {
  isMilitaryAiMode,
  MILITARY_AI_MODES,
  normalizeMilitaryAiMode,
  SHIPPED_MILITARY_AI_MODE
} from "../src/shared/settlement/military-ai-mode";
import {
  bestAction, type CommanderUnit, createMilitaryCommander, formSquads, scoreActions, type SquadView
} from "../src/shared/settlement/military-commander";
import { createCommanderObjectives } from "../src/shared/settlement/military-commander-objectives";
import { assignGroupFormation, type FormationKind, marchDirection } from "../src/shared/settlement/military-formation";
import { spreadArcherPoint } from "../src/shared/settlement/military-targeting";
import type { SettlementPoint } from "../src/shared/settlement/settlement-types";
import { createBalanceSimulation, spawnAround } from "../tools/bench/garrison-balance-harness";
import { runMotionScenario } from "../tools/bench/military-motion-metrics";
import { fieldBattleScenario } from "../tools/bench/military-motion-scenarios";

describe("military AI selection", () => {
  it("offers only the shipped flow fields + commander mode", () => {
    expect(MILITARY_AI_MODES).toEqual([
      { label: "Flow fields + commander (shipped)", value: SHIPPED_MILITARY_AI_MODE }
    ]);
    expect(isMilitaryAiMode("flowCommander")).toBe(true);
    for (const removed of ["current", "flowFields", "formations", "smartCommander", "missing"])
      expect(isMilitaryAiMode(removed)).toBe(false);
  });

  it("normalizes removed saved mode ids to the shipped mode", () => {
    for (const legacy of ["current", "flowFields", "formations", "smartCommander", "flowCommander"])
      expect(normalizeMilitaryAiMode(legacy)).toBe("flowCommander");
    expect(normalizeMilitaryAiMode("missing")).toBeUndefined();
    expect(normalizeMilitaryAiMode(undefined)).toBeUndefined();
  });
});

describe("group places used by the shipped mode", () => {
  it("lines the archers up behind the infantry along the front", () => {
    const starts = Array.from({ length: 22 }, (_, index) => ({
      x: 10 + (index % 6),
      z: 10 + Math.floor(index / 6)
    }));
    const kinds: FormationKind[] = [...Array(16).fill("foot"), ...Array(6).fill("archer")];
    const places = assignGroupFormation(
      starts,
      kinds,
      { x: 40, z: 10 },
      () => true
    ) as SettlementPoint[];
    const foot = places.slice(0, 16),
      archers = places.slice(16);
    const direction = marchDirection(starts, { x: 40, z: 10 }),
      across = { x: direction.z, z: -direction.x };
    const ahead = (point: SettlementPoint) => point.x * direction.x + point.z * direction.z;
    const side = (point: SettlementPoint) => point.x * across.x + point.z * across.z;
    expect(new Set(archers.map((place) => ahead(place).toFixed(1))).size).toBeLessThanOrEqual(2);
    const spread = (points: SettlementPoint[]) =>
      Math.max(...points.map(side)) - Math.min(...points.map(side));
    expect(spread(archers)).toBeGreaterThanOrEqual(spread(foot));
    expect(Math.max(...archers.map(ahead))).toBeLessThan(Math.min(...foot.map(ahead)));
  });

  it("spreads archers along the range arc beside the places comrades hold", () => {
    const target = { x: 20, z: 20 },
      taken = [{ x: 12.5, z: 20 }];
    const place = spreadArcherPoint({ x: 12.5, z: 20 }, target, (point) =>
      taken.every((other) => Math.hypot(other.x - point.x, other.z - point.z) > 0.9)
    );
    expect(Math.hypot(place.x - target.x, place.z - target.z)).toBeCloseTo(7.5);
    expect(Math.hypot(place.x - 12.5, place.z - 20)).toBeCloseTo(1, 1);
  });
});

describe("smart commander", () => {
  const calm: SquadView = {
    enemyDistance: Infinity,
    enemyStrength: 0,
    homeDistance: 0,
    own: 6,
    spread: 1.5,
    support: 6,
    threat: 0
  };

  it("attacks a weaker enemy nearby, pulls back when outnumbered, regroups when scattered", () => {
    const medium = COMMANDER_WEIGHTS.medium;
    expect(
      bestAction(scoreActions({ ...calm, enemyDistance: 12, enemyStrength: 3, threat: 1 }, medium))
    ).toBe("attack");
    expect(
      bestAction(
        scoreActions(
          { ...calm, enemyDistance: 4, enemyStrength: 20, support: 4, threat: 20 },
          medium
        )
      )
    ).toBe("retreat");
    expect(bestAction(scoreActions(calm, medium))).toBe("defend");
    expect(bestAction(scoreActions({ ...calm, spread: 9 }, medium))).toBe("regroup");
  });

  it("changes only the weights with difficulty: hard presses on where easy holds back", () => {
    const view = { ...calm, enemyDistance: 15, enemyStrength: 7, threat: 1 };
    expect(bestAction(scoreActions(view, COMMANDER_WEIGHTS.easy))).toBe("defend");
    expect(bestAction(scoreActions(view, COMMANDER_WEIGHTS.hard))).toBe("attack");
  });

  it("keeps its current choice unless another is clearly better", () => {
    const view = { ...calm, enemyDistance: 15, enemyStrength: 7, threat: 1 };
    const scores = scoreActions(view, COMMANDER_WEIGHTS.medium);
    const committed = scoreActions({ ...view, current: "defend" }, COMMANDER_WEIGHTS.medium);
    expect(committed.defend).toBeCloseTo(scores.defend + 0.1);
  });

  it("leads the shipped mode of normal play, flowCommander (owner decision 2026-10-19)", () => {
    expect(SHIPPED_MILITARY_AI_MODE).toBe("flowCommander");
    expect(createBalanceSimulation(32, 1).militaryAiMode()).toBe("flowCommander");
  });

  it("turns and fights once its retreat time is spent while still pressed", () => {
    const pressed = { ...calm, enemyDistance: 3, enemyStrength: 20, support: 2, threat: 20 };
    expect(bestAction(scoreActions(pressed, COMMANDER_WEIGHTS.medium))).toBe("retreat");
    expect(scoreActions({ ...pressed, retreatSpent: true }, COMMANDER_WEIGHTS.medium).retreat).toBe(
      0
    );
  });

  it("remembers a march it turned aside and ends it once the march is done", () => {
    const objectives = createCommanderObjectives();
    const walker = {
      destination: { x: 36, z: 24 },
      marching: true,
      order: "move" as const,
      uid: 7,
      x: 10,
      z: 24
    };
    objectives.observe(walker);
    // A retreat of its own is kept; one the commander ordered may be replaced.
    expect(objectives.isOwnRetreat({ ...walker, order: "retreat" })).toBe(true);
    objectives.lead([7], false);
    expect(objectives.isOwnRetreat({ ...walker, order: "retreat" })).toBe(false);
    objectives.observe({
      ...walker,
      destination: { x: 18, z: 24 },
      marching: true,
      order: "attackMove"
    });
    objectives.observe({ ...walker, destination: undefined, marching: false });
    objectives.observe({ ...walker, destination: undefined, marching: false });
    expect(objectives.of([walker])).toEqual({ order: "move", x: 36, z: 24 });
    objectives.lead([7], true);
    objectives.observe({ ...walker, marching: false });
    expect(objectives.of([walker])).toBeUndefined();
    // A march of its own that ends without a diversion leaves nothing behind.
    objectives.observe(walker);
    objectives.observe({ ...walker, marching: false });
    expect(objectives.of([walker])).toBeUndefined();
  });

  it("leads a computer march aside to fight and then on to where it was sent", () => {
    const simulation = createBalanceSimulation(48, 3, { x: 6.5, z: 6.5 });
    const walker = simulation.spawnMilitaryOpponent({ x: 10, z: 24 }, "heavy", 2, 1)!;
    const guard = simulation.spawnMilitaryOpponent({ x: 20, z: 24.6 }, "shield", 0, 2)!;
    const destination = { x: 36, z: 24 };
    expect(simulation.commandMilitaryOpponent([walker], destination, 1, "move")).toBe(true);
    for (let tick = 0; tick < 45 * 20; tick++) simulation.update(0.05);
    const body = simulation.frames().find((actor) => actor.uid === walker)!;
    expect(simulation.frames().some((actor) => actor.uid === guard)).toBe(false);
    expect(Math.hypot(body.x - destination.x, body.z - destination.z)).toBeLessThan(1.5);
  }, 60_000);

  it("groups soldiers into squads by chains of comrades, in uid order", () => {
    const unit = (uid: number, x: number) => ({
      busy: false,
      faction: 1,
      fighting: false,
      health: 1,
      home: { x, z: 0 },
      marching: false,
      rank: 0,
      type: "shield" as const,
      uid,
      x,
      z: 0
    });
    const squads = formSquads([unit(5, 0), unit(2, 5), unit(9, 10), unit(1, 30)]);
    expect(squads.map((squad) => squad.map((member) => member.uid))).toEqual([[1], [2, 5, 9]]);
  });

  it("pulls an outnumbered camp back from an attacking army", () => {
    const simulation = createBalanceSimulation(64, 3);
    [0, 1, 2].forEach(() => spawnAround(simulation, { x: 30, z: 32 }, "shield", 0, 1));
    const army = Array.from({ length: 14 }, (_, index) =>
      spawnAround(simulation, { x: 50 + (index % 2), z: 26 + index }, "heavy", 1, 2)
    );
    simulation.commandMilitaryOpponent(army, { x: 30, z: 32 }, 2, "attackMove");
    const actions = new Set<string>();
    for (let tick = 0; tick < 20 * 20; tick++) {
      simulation.update(0.05);
      for (const decision of simulation.militaryAiDebug().commander.decisions)
        if (decision.faction === 1) actions.add(decision.action);
    }
    expect(actions.has("retreat")).toBe(true);
  }, 60_000);
});

/** A commander over a hand-made field: records every squad order it sends. */
const commanderOver = (units: CommanderUnit[]) => {
  const orders: { ids: number[]; order: string; point: { x: number; z: number } }[] = [];
  const commander = createMilitaryCommander({
    cellsX: 64,
    cellsZ: 64,
    command: (ids, point, _faction, order) => orders.push({ ids: [...ids], order, point }) > 0,
    profile: () => COMMANDER_PROFILES.medium,
    isClear: () => true,
    units: () => units
  });
  return { decide: () => commander.update(DECISION_INTERVAL), orders };
};

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

/** Marching on an attack-move order to `destination`. */
const attackMoving = (unit: CommanderUnit, x: number, destination: { x: number; z: number }) =>
  Object.assign(unit, { destination, marching: true, order: "attackMove" as const, x });

/** Decides until a new order goes out (role groups hold a point `ORDER_HOLD_DECISIONS` decisions, A14-1). */
const decideUntilOrdered = (decide: () => void, orders: readonly unknown[]) => {
  const before = orders.length;
  for (let decision = 0; decision <= ORDER_HOLD_DECISIONS && orders.length === before; decision++) decide();
};

/** The front's point lies on the contact line, at most this far (tiles) from the enemy (A14-1). */
const CONTACT_REACH = 5.5;

describe("commander re-targeting (owner decision 2026-10-19)", () => {
  it("keeps a soldier closing on its target and re-targets a far one", () => {
    const enemy = fieldUnit(100, 0, 30, 20),
      near = fieldUnit(1, 1, 24, 20),
      far = fieldUnit(2, 1, 18, 20);
    const { decide, orders } = commanderOver([near, far, enemy]);
    decide();
    expect(orders).toMatchObject([{ ids: [1, 2], order: "attackMove" }]);
    expect(Math.hypot(orders[0]!.point.x - 30, orders[0]!.point.z - 20)).toBeLessThanOrEqual(CONTACT_REACH);
    const first = orders[0]!.point;
    attackMoving(near, 28, first);
    attackMoving(far, 22, first);
    // The enemy moves so far that the contact line moves more than `RETARGET`; the near soldier still closes.
    Object.assign(enemy, { x: 33, z: 26 });
    decideUntilOrdered(decide, orders);
    expect(orders[1]).toMatchObject({ ids: [2], order: "attackMove" });
    expect(Math.hypot(orders[1]!.point.x - 33, orders[1]!.point.z - 26)).toBeLessThanOrEqual(CONTACT_REACH);
  });

  it("re-targets idle soldiers and lets a retreat override a closing one", () => {
    const enemy = fieldUnit(100, 0, 30, 20),
      near = fieldUnit(1, 1, 24, 20),
      idle = fieldUnit(2, 1, 18, 20);
    const units = [near, idle, enemy];
    const { decide, orders } = commanderOver(units);
    decide();
    attackMoving(near, 28, orders[0]!.point);
    idle.x = 22;
    Object.assign(enemy, { x: 33, z: 26 });
    decideUntilOrdered(decide, orders);
    expect(orders[1]?.ids).toEqual([2]);
    for (let index = 0; index < 8; index++)
      units.push({ ...fieldUnit(101 + index, 0, 28 + (index % 4), 23 + index / 4), rank: 3, type: "heavy" });
    // Outnumbered, the whole squad pulls back, the soldier closing on its foe too.
    decide();
    expect(orders[2]).toMatchObject({ ids: [1, 2], order: "retreat" });
  });
});

describe("soldiers in the shipped mode still run the scenarios", () => {
  it("lets the commander decide for the computer side while armies march without formations", () => {
    const scenario = fieldBattleScenario(24, 20);
    const { simulation } = scenario;
    expect(simulation.setMilitaryAiMode("flowCommander")).toBe(true);
    scenario.start();
    let decisions = 0,
      flowOwned = 0;
    for (let tick = 0; tick < 20 * 20; tick++) {
      simulation.update(0.05);
      const debug = simulation.militaryAiDebug();
      decisions += debug.commander.decisions.length;
      flowOwned = Math.max(flowOwned, debug.owners.flow);
      expect(debug.owners.path + debug.owners.flow).toBeGreaterThan(0);
    }
    expect(decisions).toBeGreaterThan(0);
    expect(flowOwned).toBeGreaterThan(0);
  }, 120_000);
});

/** Every soldier's position at the end of a short battle (the determinism check). */
const battleEnd = () => {
  const scenario = fieldBattleScenario(12, 25);
  scenario.simulation.setMilitaryAiMode(SHIPPED_MILITARY_AI_MODE);
  runMotionScenario(scenario);
  return scenario.simulation
    .frames()
    .filter((actor) => actor.job === "Soldier")
    .map((actor) => `${actor.uid}:${actor.x.toFixed(6)},${actor.z.toFixed(6)}`)
    .join(" ");
};

describe("shipped military AI: determinism and scenarios", () => {
  it("plays the same battle twice the same way", () => {
    expect(battleEnd()).toEqual(battleEnd());
  }, 120_000);

});
