import { describe, expect, it } from "vitest";

import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { promoteSettlementSoldier } from "../src/shared/settlement/settlement-military";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 40;
const fixture = () => {
  const world = {
    seed: 9, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
    walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({
    world, roads, initialSettlers: 20,
    initialStock: { axe: 6, beer: 6, bow: 6, shield: 6, sword: 6, planks: 48, stone: 48 },
    canWorkerEnterPlot: () => true
  });
  return { simulation };
};

const recruit = (simulation: ReturnType<typeof fixture>["simulation"],
  type: "archer" | "heavy" | "shield") =>
  simulation.recruitStoredMilitary(simulation.headquarters.uid, type)!;

describe("fixed military equipment after recruitment", () => {
  it("recruits each fixed type with its normal paid recipe and refuses later conversion", () => {
    const { simulation } = fixture();
    const inventory = { ...simulation.headquarters.inventory };
    const heavy = recruit(simulation, "heavy");
    const archer = recruit(simulation, "archer");
    const shield = recruit(simulation, "shield");
    expect(simulation.headquarters.inventory).toMatchObject({
      axe: inventory.axe! - 1, beer: inventory.beer! - 3,
      bow: inventory.bow! - 1, shield: inventory.shield! - 1, sword: inventory.sword! - 1
    });
    expect(simulation.militarySoldiers().map(soldier => [soldier.actor, soldier.combat?.type]))
      .toEqual([[heavy, "heavy"], [archer, "archer"], [shield, "shield"]]);
    const tools = new Map(simulation.frames().map(actor => [actor.uid, actor.tool]));
    expect(tools.get(heavy)).toBe("axe");
    expect(tools.get(archer)).toBe("bow");
    expect(tools.get(shield)).toBe("sword");
    const before = {
      actors: structuredClone(simulation.frames()),
      inventory: structuredClone({ ...simulation.headquarters.inventory }),
      soldiers: structuredClone(simulation.militarySoldiers())
    };
    for (const id of [heavy, archer, shield]) {
      for (const type of ["archer", "heavy", "shield"] as const)
        expect(simulation.equipMilitary(id, type)).toBe(false);
    }
    expect(simulation.frames()).toEqual(before.actors);
    expect(simulation.headquarters.inventory).toEqual(before.inventory);
    expect(simulation.militarySoldiers()).toEqual(before.soldiers);
  });

  it("ordinary rank promotion preserves the recruited type, tool and health fraction", () => {
    const { simulation } = fixture();
    const id = recruit(simulation, "heavy");
    const soldier = simulation.militarySoldiers().find(entry => entry.actor === id)!;
    soldier.combat!.hp = militaryHealth("heavy", 0) / 2;
    const tool = simulation.frames().find(actor => actor.uid === id)!.tool;
    expect(promoteSettlementSoldier(soldier, 1)).toBe(true);
    expect(soldier.rank).toBe(1);
    expect(soldier.combat?.type).toBe("heavy");
    expect(soldier.combat?.hp).toBe(militaryHealth("heavy", 1) / 2);
    expect(simulation.frames().find(actor => actor.uid === id)?.tool).toBe(tool);
  });

  it("keeps type, rank, HP and recovery through transport, save and reload", () => {
    const { simulation } = fixture();
    simulation.receiveTroops([
      { hp: 70, rank: 2, recoverySeconds: 42, type: "archer" },
      { hp: 61.5, rank: 1, type: "heavy" }
    ]);
    const troops = simulation.militarySoldiers();
    const archer = troops.find(soldier => soldier.combat?.type === "archer")!;
    const heavy = troops.find(soldier => soldier.combat?.type === "heavy")!;
    expect(archer).toMatchObject({ rank: 2, recoverySeconds: 42 });
    expect(archer.combat?.hp).toBe(70);
    expect(heavy).toMatchObject({ rank: 1 });
    expect(heavy.combat?.hp).toBe(61.5);
    expect(simulation.frames().find(actor => actor.uid === archer.actor)?.tool).toBe("bow");
    expect(simulation.frames().find(actor => actor.uid === heavy.actor)?.tool).toBe("axe");
    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.militarySoldiers()).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: archer.actor, rank: 2, recoverySeconds: 42,
        combat: expect.objectContaining({ type: "archer", hp: 70 }) }),
      expect.objectContaining({ actor: heavy.actor, rank: 1,
        combat: expect.objectContaining({ type: "heavy", hp: 61.5 }) })
    ]));
    expect(simulation.frames().find(actor => actor.uid === archer.actor)?.tool).toBe("bow");
    expect(simulation.frames().find(actor => actor.uid === heavy.actor)?.tool).toBe("axe");
  });
});
