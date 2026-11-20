import { describe, expect, it } from "vitest";

import {
  createFactionKnowledge, factionKnowledgeSaveError, HIT_ALERT_TICKS, KNOWLEDGE_MEMORY_TICKS, type ObservedUnit
} from "../src/shared/settlement/faction-knowledge";
import { createMilitarySpatialGrid } from "../src/shared/settlement/military-spatial-grid";
import { createFieldCivilianThreat } from "../src/shared/settlement/settlement-combat";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";

/** A13 phase 3: what a faction knows (seen, hit alert, last known) and how it ages, saves and loads. */
interface Harness {
  knowledge: ReturnType<typeof createFactionKnowledge>;
  /** Advances the game tick and runs the vision phase. */
  step: (ticks?: number) => void;
  units: ObservedUnit[];
  /** Cells x < `sight` are seen by the computer factions; faction 0 sees x >= `playerSight`. */
  view: { playerSight: number; sight: number };
}

const unit = (uid: number, faction: number, x: number, z = 0): ObservedUnit =>
  ({ faction, health: .5, rank: 1, type: "shield", uid, x, z });

const harness = (): Harness => {
  let tick = 0;
  const units: ObservedUnit[] = [], view = { playerSight: 100, sight: 10 };
  const sees = (faction: number, x: number) => faction > 0 ? x < view.sight : x >= view.playerSight;
  const knowledge = createFactionKnowledge({ now: () => tick, sees: () => sees, units: () => units });
  return {
    knowledge, units, view,
    step: (ticks = 1) => { for (let index = 0; index < ticks; index++) { knowledge.observe(); tick++; } }
  };
};

describe("faction knowledge", () => {
  it("knows seen units, and unseen ones only under a hit alert until it expires", () => {
    const { knowledge, step } = harness();
    const seen = unit(7, 0, 4), hidden = unit(8, 0, 40);
    expect(knowledge.knows(1, seen)).toBe(true);
    expect(knowledge.knows(1, hidden)).toBe(false);
    knowledge.alert(1, hidden.uid);
    expect(knowledge.knows(1, hidden)).toBe(true);
    expect(knowledge.knows(2, hidden)).toBe(false);
    step(HIT_ALERT_TICKS - 1);
    expect(knowledge.knows(1, hidden)).toBe(true);
    // A second blow refreshes the alert.
    knowledge.alert(1, hidden.uid);
    step(HIT_ALERT_TICKS - 1);
    expect(knowledge.alerted(1, hidden.uid)).toBe(true);
    step(1);
    expect(knowledge.knows(1, hidden)).toBe(false);
  });

  it("remembers a unit that left sight at its last known place until the memory expires", () => {
    const { knowledge, step, units } = harness();
    const viewer = unit(1, 1, 2), walker = unit(5, 0, 6);
    units.push(viewer, walker);
    step();
    walker.x = 9.5; step();
    walker.x = 30; step();
    const [memory] = knowledge.remembered(1, () => false);
    expect(memory).toMatchObject({ faction: 0, health: .5, type: "shield", uid: 5, x: 9.5 });
    step(KNOWLEDGE_MEMORY_TICKS - 2);
    expect(knowledge.remembered(1, () => false)).toHaveLength(1);
    step(1);
    expect(knowledge.remembered(1, () => false)).toHaveLength(0);
    // The player faction keeps no memories (no commander reads them).
    expect(knowledge.remembered(0, () => false)).toHaveLength(0);
  });

  it("forgets a unit that vanished in sight, but remembers one that vanished unseen", () => {
    const { knowledge, step, units } = harness();
    const viewer = unit(1, 1, 2), fallen = unit(5, 0, 6), walker = unit(6, 0, 8);
    units.push(viewer, fallen, walker);
    step();
    walker.x = 40; step();
    units.splice(units.indexOf(fallen), 1);
    units.splice(units.indexOf(walker), 1);
    step();
    expect(knowledge.remembered(1, () => false).map(record => record.uid)).toEqual([6]);
  });

  it("saves only live entries in canonical order and loads them back equal", () => {
    const { knowledge, step, units } = harness();
    units.push(unit(1, 2, 2), unit(9, 1, 3), unit(4, 0, 5), unit(3, 0, 7));
    knowledge.alert(2, 4); knowledge.alert(1, 3);
    step();
    units.length = 2;
    step();
    const saved = knowledge.save();
    expect(factionKnowledgeSaveError(saved)).toBeNull();
    expect(saved.alerts.map(([viewer, uid]) => [viewer, uid])).toEqual([[1, 3], [2, 4]]);
    expect(saved.records.map(([viewer, uid]) => [viewer, uid])).toEqual([[1, 1], [2, 9]]);
    const copy = harness();
    copy.knowledge.restore(structuredClone(saved));
    expect(copy.knowledge.save()).toEqual(saved);
    step(KNOWLEDGE_MEMORY_TICKS + 1);
    // Still seen: refreshed every tick (known without a break since tick 0); the alerts ran out.
    const last = 2 + KNOWLEDGE_MEMORY_TICKS;
    expect(knowledge.save()).toEqual({ alerts: [], records: [[1, 1, 2, "shield", 1, .5, 2, 0, last, 0],
      [2, 9, 1, "shield", 1, .5, 3, 0, last, 0]] });
  });

  it("keeps the first known tick while a unit stays known and restarts it after a gap (A14-4b)", () => {
    const { knowledge, step, units } = harness();
    const viewer = unit(1, 1, 2), walker = unit(5, 0, 6);
    units.push(viewer, walker);
    step(3);
    expect(knowledge.knownSince(1, walker.uid)).toBe(0);
    walker.x = 30; step(4);
    expect(knowledge.knownSince(1, walker.uid)).toBe(0);
    walker.x = 6; step();
    expect(knowledge.knownSince(1, walker.uid)).toBe(7);
    // A format 11 record (no first known tick) loads as known since its last tick.
    const saved = knowledge.save();
    saved.records = saved.records.map(entry => entry.slice(0, 9) as typeof entry);
    const copy = harness();
    copy.knowledge.restore(saved);
    expect(copy.knowledge.save().records.map(entry => entry[9])).toEqual([7]);
  });

  it("refuses malformed saved knowledge and accepts an older save without it", () => {
    expect(factionKnowledgeSaveError(undefined)).toBeNull();
    expect(factionKnowledgeSaveError({ alerts: [], records: [] })).toBeNull();
    expect(factionKnowledgeSaveError({ alerts: [[1, -2, 3]], records: [] })).not.toBeNull();
    expect(factionKnowledgeSaveError({ alerts: [], records: [[1, 2, 0, "dragon", 0, 1, 0, 0, 0]] })).not.toBeNull();
    expect(factionKnowledgeSaveError({ alerts: [], records: [[1, 2, 0, "shield", 0, 1, NaN, 0, 0]] })).not.toBeNull();
    expect(factionKnowledgeSaveError([])).not.toBeNull();
  });

  it("knows everything when the island has no vision layer (bare fixtures)", () => {
    const knowledge = createFactionKnowledge({ now: () => 0, sees: () => undefined, units: () => [] });
    expect(knowledge.knows(1, unit(3, 0, 500))).toBe(true);
  });
});

describe("civilian raider awareness (owner 2026-11-13: flee only from seen raiders)", () => {
  it("counts only raiders the player sees", () => {
    const { knowledge, view } = harness();
    view.playerSight = 20;
    const body = (uid: number, x: number) => ({ uid, visible: true, x, z: 4 }) as SettlementActor;
    const seenRaider = body(11, 30), hiddenRaider = body(12, 6);
    const grid = createMilitarySpatialGrid<SettlementActor>(64, 64);
    const entries = [seenRaider, hiddenRaider];
    grid.rebuild(entries);
    const { beginTick, threat } = createFieldCivilianThreat(grid, entries, () => 1, knowledge,
      { besieged: () => false, standing: () => true });
    beginTick();
    expect(threat.active()).toBe(true);
    expect(threat.enemyWithin({ x: 6, z: 5 }, 3)).toBe(false);
    expect(threat.enemyWithin({ x: 29, z: 5 }, 3)).toBe(true);
    expect(threat.nearestEnemy({ x: 10, z: 4 }, 30)).toBe(seenRaider);
    view.playerSight = 100;
    beginTick();
    expect(threat.active()).toBe(false);
    expect(threat.enemyWithin({ x: 29, z: 5 }, 3)).toBe(false);
  });
});
