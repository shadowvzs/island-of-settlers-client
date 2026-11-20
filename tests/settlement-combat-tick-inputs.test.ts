import { describe, expect, it } from "vitest";

import type { CombatCore } from "../src/shared/settlement/settlement-combat-core";
import {
  createArcheryTargetSource, createCommanderUnitSources, refreshActorIndex
} from "../src/shared/settlement/settlement-combat-tick-inputs";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";

const body = (uid: number, phase = "militaryField", visible = true) =>
  ({ uid, phase, visible, x: uid, z: 0 }) as unknown as SettlementActor;

const soldier = (actor: number, faction: number): SettlementSoldier => ({
  actor,
  building: -3,
  combat: { cooldown: 0, faction, hp: 100, type: "shield" },
  rank: 0,
  stationed: false
});

const createCore = (
  soldiers: Map<number, SettlementSoldier>, defender: (uid: number) => boolean = () => false
) => {
  const memories = new Map<number, { seekTime: number; struck: boolean }>();
  const core = {
    context: {},
    inField: (entry: SettlementActor | undefined) => entry?.phase === "militaryField" && entry.visible &&
      !soldiers.get(entry.uid)?.combat?.towerFall,
    memoryOf: (uid: number) => {
      let memory = memories.get(uid);
      if (!memory) memories.set(uid, memory = { seekTime: 0, struck: false });
      return memory;
    },
    pendingMarches: new Map(),
    sieges: { atDoor: () => false, isDefender: defender },
    soldiers
  } as unknown as CombatCore;
  return { core, memories };
};

const sourcesOver = (
  entries: SettlementActor[], soldiers: Map<number, SettlementSoldier>,
  owns: (uid: number) => boolean = () => false, defender: (uid: number) => boolean = () => false
) => {
  const { core, memories } = createCore(soldiers, defender);
  const sources = createCommanderUnitSources(entries, soldiers, core.memoryOf, () => core, defender,
    owns, () => false);
  return { memories, sources };
};

describe("commander unit sources", () => {
  it("lists the factions of eligible field bodies and records their memory", () => {
    const soldiers = new Map([[1, soldier(1, 1)], [2, soldier(2, 2)], [3, soldier(3, 3)]]);
    const entries = [body(1), body(2), body(3)];
    soldiers.get(3)!.combat!.towerFall = { fromY: 0, groundY: 0, remaining: 0 };
    const { memories, sources } = sourcesOver(entries, soldiers, uid => uid === 2);
    expect(sources.factions()).toEqual([1]);
    expect([...memories.keys()]).toEqual([1]);
  });

  it("excludes the mid-tick invisible body and the siege defender like collectCommanderUnits", () => {
    const soldiers = new Map([[1, soldier(1, 1)], [2, soldier(2, 2)], [3, soldier(3, 3)]]);
    const { memories, sources } = sourcesOver([body(1), body(2, "militaryField", false), body(3)],
      soldiers, () => false, uid => uid === 3);
    expect(sources.factions()).toEqual([1]);
    expect([...memories.keys()]).toEqual([1]);
  });

  it("builds units only from bodies the commander owns and reuses its arrays", () => {
    const soldiers = new Map([[1, soldier(1, 1)], [2, soldier(2, 2)]]);
    const { sources } = sourcesOver([body(1), body(2)], soldiers, uid => uid === 2);
    const first = sources.units(), factions = sources.factions();
    expect(first.map((unit) => unit.uid)).toEqual([1]);
    expect(sources.units()).toBe(first);
    expect(sources.factions()).toBe(factions);
  });
});

describe("archery target source", () => {
  it("skips the defenders and reuses one array", () => {
    const source = createArcheryTargetSource();
    const entries = [body(1), body(2), body(3)];
    const first = source(entries, uid => uid === 2);
    expect(first.map((entry) => entry.uid)).toEqual([1, 3]);
    expect(source(entries, () => true)).toBe(first);
    expect(first).toEqual([]);
  });
});

describe("actor index refresh", () => {
  it("clears stale entries and indexes the live actors", () => {
    const index = new Map<number, SettlementActor>([[9, body(9)]]);
    const actors = [body(1), body(2)];
    refreshActorIndex(actors, index);
    expect([...index.keys()]).toEqual([1, 2]);
    expect(index.get(1)).toBe(actors[0]);
    expect(index.has(9)).toBe(false);
  });
});
