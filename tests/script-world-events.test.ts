import { buildingEntry } from "@shared/catalog";
import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import type { ScriptEmission } from "../../island-of-settlers-shared/src/script/types/emission";
import type { MapScript, ScriptEvent, ScriptTrigger } from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, num, numberVariable, player1, ref, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson } from "../src/shared/settlement/settlement-state-hash";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";
import {
  advance, crew, ENEMY, mannedFixture, sendAttackGroup, standing, villageFixture
} from "./helpers/military-assault-fixture";

/**
 * TRG3a: unit and building events from real simulation scenarios. Each counting trigger increases its own
 * variable; a spy on the engine's `emit` records the emitted slots. Maps without a script are covered by the
 * replay hash tests (bug-replay, command-log-verify, server bundle).
 */

type Slots = ScriptEvent["slots"];

const on = (kind: ScriptEvent["kind"], slots: Slots = {}, player: ScriptEvent["player"] = { kind: "any" }) =>
  ({ kind, player, slots }) as ScriptEvent;

const counter = (id: string, event: ScriptEvent): ScriptTrigger => trigger(id, {
  actions: [doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", `v-${id}`) })],
  events: [event]
});

const scriptOf = (counters: Record<string, ScriptEvent>): MapScript => emptyScript({
  triggers: Object.entries(counters).map(([id, event]) => counter(id, event)),
  variables: Object.keys(counters).map(id => numberVariable(`v-${id}`, id))
});

const valueOf = (sim: SettlementSimulation, id: string) => sim.script()!.engine.state.values[`v-${id}`]?.value;

/** Records every emission the engine receives (after the subscription gate). */
const recordEmissions = (sim: SettlementSimulation) => {
  const engine = sim.script()!.engine, emitted: ScriptEmission[] = [];
  const original = engine.emit.bind(engine);
  engine.emit = emission => { if (engine.isSubscribed(emission.kind)) emitted.push(emission); original(emission); };
  return emitted;
};

const ofKind = (emitted: readonly ScriptEmission[], kind: ScriptEmission["kind"]) =>
  emitted.filter(emission => emission.kind === kind);

const soldierFamily = (faction: number) =>
  ({ family: ref("family", "soldier"), kind: "family", owner: { faction, kind: "slot" } }) as Slots[string];

/** The §14.1 pattern on soldiers: player 1's soldiers kill player 2's soldiers → counter. */
const SOLDIER_KILLS = {
  damagedBySoldier: on("actorDamaged", { source: soldierFamily(0) }, { faction: ENEMY, kind: "slot" }),
  gone: on("actorGone"),
  killed: on("actorKilled"),
  kills: on("actorKilled", { killer: soldierFamily(0) }, { faction: ENEMY, kind: "slot" }),
  lowHealth: on("actorDamaged", { percent: num(50) }, { faction: ENEMY, kind: "slot" })
};

const skirmish = () => {
  const sim = createBalanceSimulation(48, 123, undefined, world => { world.script = scriptOf(SOLDIER_KILLS); });
  sim.receiveTroops([{ hp: militaryHealth("shield", 2), rank: 2, type: "shield" }]);
  const emitted = recordEmissions(sim);
  const id = sim.militarySoldiers()[0]!.actor;
  expect(sim.commandMilitary([id], { x: 23, z: 23 }, "move")).toBe(true);
  advance(sim, 90);
  expect(sim.startMilitaryTestSkirmish()).toHaveLength(3);
  return { emitted, sim };
};

const enemiesLeft = (sim: SettlementSimulation) =>
  sim.militarySoldiers().filter(soldier => soldier.combat?.faction === ENEMY).length;

describe("TRG3a soldier combat events", () => {
  it("emits damage with its source and each death once with victim and killer; the kill counter runs", () => {
    const { emitted, sim } = skirmish();
    for (let second = 0; second < 240 && enemiesLeft(sim) === 3; second++) advance(sim, 1);
    advance(sim, 1);
    const fallen = 3 - enemiesLeft(sim);
    expect(fallen).toBeGreaterThan(0);
    const killed = ofKind(emitted, "actorKilled");
    expect(new Set(killed.map(emission => emission.actors!.victim!.handle.id)).size).toBe(killed.length);
    const enemyKills = killed.filter(emission => emission.actors!.victim!.owner === ENEMY);
    expect(enemyKills).toHaveLength(fallen);
    for (const kill of enemyKills) {
      expect(kill.actors!.victim!.type).toMatch(/^soldier:/);
      expect(kill.actors!.killer).toMatchObject({ family: "soldier.melee", owner: 0, type: "soldier:shield" });
      expect(kill.responses!.killingActor).toEqual(kill.actors!.killer!.handle);
    }
    expect(valueOf(sim, "kills")).toBe(fallen);
    expect(valueOf(sim, "killed")).toBe(killed.length);
    const gone = ofKind(emitted, "actorGone").filter(emission => emission.values?.reason === "died");
    expect(gone).toHaveLength(killed.length);
    const damaged = ofKind(emitted, "actorDamaged").filter(emission => emission.actors!.subject!.owner === ENEMY);
    expect(damaged.length).toBeGreaterThanOrEqual(fallen);
    expect(damaged.every(emission => emission.actors!.source?.owner === 0)).toBe(true);
    expect(valueOf(sim, "damagedBySoldier")).toBe(damaged.length);
    // "Health below 50 %" fires once per enemy that crossed it.
    const crossed = damaged.filter(emission =>
      (emission.values!.percentBefore as number) >= 50 && (emission.values!.percent as number) < 50);
    expect(valueOf(sim, "lowHealth")).toBe(crossed.length);
  }, 240_000);

  it("continues identically after a save taken mid-fight (settlement and script state)", () => {
    const { sim } = skirmish();
    advance(sim, 4);
    const checkpoint = JSON.stringify(sim.saveState());
    const scriptAfter = () => ({ hash: sim.script()!.engine.hash(), run: sim.saveState().scriptRun });
    advance(sim, 40);
    const live = scriptAfter();
    const liveSave = canonicalJson(sim.saveState());
    expect(sim.loadState(JSON.parse(checkpoint))).toEqual({ ok: true });
    advance(sim, 40);
    // A reloaded island continues exactly like the uninterrupted one: script run state and whole save.
    expect(scriptAfter()).toEqual(live);
    expect(canonicalJson(sim.saveState()) === liveSave).toBe(true);
  }, 240_000);
});

describe("TRG3a building and settler events", () => {
  it("a village under construction emits placed, job, tool, door and completion events with their slots", () => {
    const script = scriptOf({
      completed: on("constructionCompleted"), entered: on("enteredBuilding"), job: on("jobAssigned"),
      left: on("leftBuilding"), occupied: on("buildingOccupied"), placed: on("constructionPlaced", {}, player1),
      tool: on("toolReceived")
    });
    const { sim, site } = villageFixture(script);
    const emitted = recordEmissions(sim);
    for (let second = 0; second < 600 && valueOf(sim, "occupied") === 0; second++) advance(sim, 1);
    const type = buildingEntry(site.typeId)!.id;
    expect(valueOf(sim, "placed")).toBe(1);
    expect(valueOf(sim, "completed")).toBe(1);
    expect(ofKind(emitted, "constructionCompleted")[0]!.actors!.building).toMatchObject({ owner: 0, type });
    const jobs = ofKind(emitted, "jobAssigned");
    expect(jobs.map(emission => emission.actors!.settler!.type)).toEqual(
      expect.arrayContaining(["settler:builder", "settler:woodcutter"]));
    expect(ofKind(emitted, "toolReceived").map(emission => emission.values!.ware)).toEqual(
      expect.arrayContaining(["hammer", "axe"]));
    const occupied = ofKind(emitted, "buildingOccupied");
    expect(occupied).toHaveLength(1);
    expect(occupied[0]!.actors).toMatchObject({ building: { type }, job: { type: "settler:woodcutter" } });
    const left = ofKind(emitted, "leftBuilding");
    expect(left.length).toBeGreaterThan(0);
    expect(left[0]!.actors!.building!.type).toBe("building:headquarters");
    expect(valueOf(sim, "left")).toBe(left.length);
    expect(valueOf(sim, "entered")).toBe(ofKind(emitted, "enteredBuilding").length);
  }, 240_000);

  it("an assault damages the walls with the attacker as source; the fall is destroyed (not demolished)", () => {
    const script = scriptOf({
      damaged: on("actorDamaged", { subject: { kind: "type", owner: player1,
        type: { type: ref("content", "building:guardhouse") } } as Slots[string] }),
      destroyed: on("buildingDestroyed", { cause: { k: "lit", type: "string", value: "destroyed" } } as Slots),
      demolished: on("buildingDestroyed", { cause: { k: "lit", type: "string", value: "demolished" } } as Slots),
      garrisoned: on("garrisoned"), gone: on("actorGone")
    });
    const { sim, site } = mannedFixture(2, script);
    const emitted = recordEmissions(sim);
    for (let second = 0; second < 240 && crew(sim, site.uid).length === 0; second++) advance(sim, 1);
    expect(valueOf(sim, "garrisoned")).toBeGreaterThan(0);
    expect(ofKind(emitted, "garrisoned")[0]!.actors!.building!.handle.id).toBe(site.uid);
    sendAttackGroup(sim, site.access, 12, 2);
    for (let second = 0; second < 900 && standing(sim, site.uid); second++) advance(sim, 1);
    expect(standing(sim, site.uid)).toBe(false);
    const walls = ofKind(emitted, "actorDamaged").filter(emission => emission.actors!.subject!.handle.space === "building");
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every(emission => emission.actors!.source?.owner === ENEMY)).toBe(true);
    expect(valueOf(sim, "damaged")).toBe(walls.length);
    const destroyed = ofKind(emitted, "buildingDestroyed");
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]!.values!.cause).toBe("destroyed");
    expect(destroyed[0]!.responses!.killingActor).toMatchObject({ space: "actor" });
    expect(valueOf(sim, "destroyed")).toBe(1);
    expect(valueOf(sim, "demolished")).toBe(0);
    expect(ofKind(emitted, "actorGone").some(emission =>
      emission.actors!.subject!.handle.id === site.uid && emission.values!.reason === "died")).toBe(true);
  }, 240_000);

  it("demolition by the owner is `demolished`; a player click emits actorClicked", () => {
    const script = scriptOf({ clicked: on("actorClicked"), demolished: on("buildingDestroyed") });
    const { sim, site } = villageFixture(script);
    const emitted = recordEmissions(sim);
    sim.select(site.uid);
    advance(sim, 1);
    expect(valueOf(sim, "clicked")).toBe(1);
    expect(sim.demolishBuilding(site.uid)).toMatchObject({ ok: true });
    advance(sim, 1);
    expect(ofKind(emitted, "buildingDestroyed").map(emission => emission.values!.cause)).toEqual(["demolished"]);
    expect(valueOf(sim, "demolished")).toBe(1);
  });
});

describe("TRG3a bindings, gates and catch-up", () => {
  const authoredWorld = (script: MapScript) => {
    const world = {
      blocking: new Uint8Array(40 ** 2), buildClass: new Uint8Array(40 ** 2).fill(BUILD.large), cellsX: 40,
      cellsZ: 40, heights: new Float32Array(41 ** 2), mineZone: new Uint16Array(40 ** 2), mineZones: [],
      oreAmount: new Uint8Array(40 ** 2), props: { count: 0, scale: new Float32Array(), types: new Uint8Array(),
        x: new Float32Array(), z: new Float32Array() }, script, seaLevel: -1, seed: 9, start: { x: 5.5, z: 5.5 },
      walkCost: new Uint8Array(40 ** 2).fill(10)
    } as unknown as WorldData;
    world.scenario = { ...createMapScenario(), buildings: [{ defenders: 0, faction: 2, id: 5, rotation: 0, type: 1,
      x: 29, z: 12 }], headquarters: { rotation: 0, x: 8, z: 8 }, kind: "colony", landing: { x: 14, z: 14 },
    nextObjectId: 8, stock: { ...STARTER_STOCK }, units: [
      { faction: 2, group: 3, heading: 1, id: 7, rank: 1, type: "archer", x: 25, z: 25 },
      { faction: 2, group: 3, heading: 0, id: 3, rank: 0, type: "shield", x: 26, z: 27 }
    ] };
    return world;
  };
  const placed = (id: string, content: string, objectIds: number[]) => ({
    binding: "placed", hiddenAtStart: false, id, lifetime: "keepIncarnation", name: id,
    objects: objectIds.map(objectId => ({ cell: 0, content: ref("content", content), objectId })),
    owner: { faction: 2, kind: "slot" }
  }) as unknown as MapScript["actors"][number];
  const bindingScript = () => ({ ...scriptOf({
    clicked: on("actorClicked", { subject: { actor: ref("actor", "camp"), kind: "instance" } as Slots[string] }),
    guardKilled: on("actorKilled", { victim: { actor: ref("actor", "guards"), kind: "instance" } as Slots[string] })
  }), actors: [placed("guards", "soldier:archer", [7, 3]), placed("camp", "building:barracks", [5])] });

  it("binds placed actors through the spawn table; instance events and gone clean-up follow the members", () => {
    const world = authoredWorld(bindingScript());
    const sim = createSettlementSimulation({ roads: createRoadNetwork(world), world });
    const engine = sim.script()!.engine;
    const guards = [7, 3].map(id => sim.authoredObjectHandle(id)!.uid);
    const camp = sim.authoredObjectHandle(5)!.uid;
    expect(engine.state.actors.guards!.members.map(member => member.handle))
      .toEqual(guards.map(id => ({ generation: 0, id, space: "actor" })));
    expect(engine.state.actors.camp!.members[0]!.handle).toEqual({ generation: 0, id: camp, space: "building" });
    sim.select(camp);
    sim.select(guards[0]!);
    advance(sim, 1);
    expect(valueOf(sim, "clicked")).toBe(1);
    sim.receiveTroops(Array.from({ length: 6 }, () => ({ hp: militaryHealth("heavy", 2), rank: 2, type: "heavy" })));
    const ours = sim.militarySoldiers().filter(soldier => soldier.combat?.faction === 0).map(soldier => soldier.actor);
    expect(sim.commandMilitary(ours, { x: 25, z: 25 }, "attackMove")).toBe(true);
    const alive = () => sim.militarySoldiers().filter(soldier => guards.includes(soldier.actor)).length;
    for (let second = 0; second < 300 && alive() === 2; second++) advance(sim, 1);
    advance(sim, 1);
    const fallen = 2 - alive();
    expect(fallen).toBeGreaterThan(0);
    expect(valueOf(sim, "guardKilled")).toBe(fallen);
    expect(engine.state.actors.guards!.members).toHaveLength(2 - fallen);
  }, 240_000);

  it("an empty script never reaches the engine's emit; catch-up delivers nothing and freezes the clock", () => {
    const empty = createBalanceSimulation(48, 123, undefined, world => { world.script = emptyScript(); });
    const emitted = recordEmissions(empty);
    let calls = 0;
    const engine = empty.script()!.engine, original = engine.emit.bind(engine);
    engine.emit = emission => { calls++; original(emission); };
    empty.receiveTroops([{ hp: militaryHealth("shield", 2), rank: 2, type: "shield" }]);
    advance(empty, 30);
    expect(calls).toBe(0);
    expect(emitted).toEqual([]);
    const { emitted: busy, sim } = skirmish();
    advance(sim, 2);
    sim.setScriptMode("catchUp");
    const before = sim.saveState().scriptRun, count = busy.length;
    advance(sim, 30);
    expect(busy).toHaveLength(count);
    expect(sim.saveState().scriptRun).toEqual(before);
    sim.endScriptCatchUp();
    advance(sim, 1);
    expect(sim.script()!.engine.state.scriptTick).toBe(before!.state.scriptTick + 20);
  }, 240_000);

  it("islands without a script carry no script state and save no run state", () => {
    const sim = createBalanceSimulation(48, 123);
    expect(sim.script()).toBeUndefined();
    advance(sim, 5);
    expect(sim.saveState()).not.toHaveProperty("scriptRun");
  });
});
