import { buildingEntry } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import type { ScriptEngine } from "../../island-of-settlers-shared/src/script/engine/engine";
import type { ScriptEmission } from "../../island-of-settlers-shared/src/script/types/emission";
import type { MapScript, ScriptEvent, ScriptTrigger } from "../../island-of-settlers-shared/src/script/types/index";
import type { ActorHandleValue } from "../../island-of-settlers-shared/src/script/types/values";
import {
  doStep, emptyScript, num, numberVariable, ref, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { createProximityWatch } from "../src/shared/script-world/proximity-watch";
import type { ScriptMembers } from "../src/shared/script-world/script-world-members";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BRIDGE_SCENE_RIVERS, bridgeRiverScene } from "./helpers/bridge-river-scene";
import { advance } from "./helpers/military-assault-fixture";
import { actorOf, garrisonIsland, on, recordEmissions, teleport, tick } from "./helpers/script-watch-fixture";

/**
 * TRG4b proximity watch: `cameNear` around a static target (auto-circle in the cell lists), `cameNearMoving`
 * around a unit and `bridgeStepped` on a deck. Each fires once per approach, stays silent in catch-up and
 * continues identically after a reload (the watch keeps no saved state).
 */

type Slots = ScriptEvent["slots"];

const unit = (id: number): ActorHandleValue => ({ generation: 0, id, space: "actor" });
const variableTarget = (id: string) => ({ kind: "variable", variable: ref("variable", id) }) as Slots[string];
const buildingType = (typeId: number) =>
  ({ kind: "type", type: { type: ref("content", buildingEntry(typeId)!.id) } }) as unknown as Slots[string];
const near = (kind: "cameNear" | "cameNearMoving", target: Slots[string], radius: number) =>
  on(kind, { radius: num(radius), target });

/** Counts its event in `v-<id>` and stores the approaching unit (replacing the previous one) in `a-<id>`. */
const watcher = (id: string, event: ScriptEvent, response = "enteringActor"): ScriptTrigger => trigger(id, {
  actions: [
    doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", `v-${id}`) }),
    doStep("s2", "storeActor", { mode: str("replace"), selector: { key: response, kind: "response" },
      variable: ref("variable", `a-${id}`) })
  ],
  events: [event]
});

const actorVariable = (id: string): MapScript["variables"][number] =>
  ({ id, initial: { type: "actor", value: [] }, name: id, type: "actor" });

const scriptOf = (watchers: Record<string, ScriptEvent>, response?: string): MapScript => emptyScript({
  triggers: Object.entries(watchers).map(([id, event]) => watcher(id, event, response)),
  variables: [...Object.keys(watchers).flatMap(id => [numberVariable(`v-${id}`, id), actorVariable(`a-${id}`)]),
    actorVariable("a-target")]
});

const valueOf = (sim: SettlementSimulation, id: string) => sim.script()!.engine.state.values[`v-${id}`]?.value;
const storedOf = (sim: SettlementSimulation, id: string) => sim.script()!.engine.state.values[`a-${id}`]?.value;

const proximityEvents = (emitted: readonly ScriptEmission[]) => emitted
  .filter(emission => emission.kind === "cameNear" || emission.kind === "cameNearMoving")
  .map(emission => ({ id: emission.actors!.subject!.handle.id, kind: emission.kind,
    target: emission.actors!.target!.handle.id }));

describe("TRG4b came near a static target (real simulation)", () => {
  it("one event per approach of the headquarters, the approaching unit and the target as responses", () => {
    const probe = garrisonIsland(emptyScript()).sim.headquarters;
    const script = scriptOf({ near: near("cameNear", buildingType(probe.typeId), 4) });
    const { sim, soldiers } = garrisonIsland(script);
    const [first, second] = soldiers.map(uid => actorOf(sim, uid));
    const { uid, x, z } = sim.headquarters;
    // The soldiers left the headquarters door inside its circle: start them far away.
    for (const soldier of [first!, second!]) teleport(soldier, x + 24.5, z + 24.5);
    tick(sim);
    // Both came out of the door inside the circle: appearing inside counted as one approach each.
    expect(valueOf(sim, "near")).toBe(2);
    const emitted = recordEmissions(sim);
    teleport(first!, x + 3.2, z);
    tick(sim);
    expect(proximityEvents(emitted)).toEqual([{ id: first!.uid, kind: "cameNear", target: uid }]);
    expect(emitted[0]!.responses).toMatchObject({ enteringActor: unit(first!.uid),
      targetActor: { id: uid, space: "building" } });
    expect(emitted[0]!.actors!.target).toMatchObject({ type: buildingEntry(probe.typeId)!.id });
    expect(valueOf(sim, "near")).toBe(3);
    expect(storedOf(sim, "near")).toEqual([unit(first!.uid)]);
    // Moving on inside the circle announces nothing; leaving and coming back is a new approach.
    teleport(first!, x + 2.2, z);
    tick(sim);
    teleport(first!, x + 12.5, z);
    tick(sim);
    expect(proximityEvents(emitted)).toHaveLength(1);
    teleport(first!, x + 3.2, z);
    teleport(second!, x, z + 3.4);
    tick(sim);
    expect(proximityEvents(emitted).slice(1)).toEqual([
      { id: first!.uid, kind: "cameNear", target: uid }, { id: second!.uid, kind: "cameNear", target: uid }
    ]);
    expect(valueOf(sim, "near")).toBe(5);
  }, 240_000);

  it("a soldier walking up to the headquarters fires exactly once; catch-up stays silent", () => {
    const probe = garrisonIsland(emptyScript()).sim.headquarters;
    const script = scriptOf({ near: near("cameNear", buildingType(probe.typeId), 5) });
    const { sim, soldiers } = garrisonIsland(script);
    const [first, second] = soldiers;
    const walker = actorOf(sim, first!);
    const far = () => Math.hypot(walker.x - 30, walker.z - 30) < 3;
    expect(sim.commandMilitary([first!], { x: 30, z: 30 }, "move")).toBe(true);
    for (let waited = 0; waited < 120 && !far(); waited++) advance(sim, 1);
    expect(far()).toBe(true);
    const emitted = recordEmissions(sim);
    expect(sim.commandMilitary([first!], { x: 9, z: 9 }, "move")).toBe(true);
    for (let waited = 0; waited < 120 && proximityEvents(emitted).length === 0; waited++) advance(sim, 1);
    advance(sim, 5);
    expect(proximityEvents(emitted)).toEqual([{ id: first, kind: "cameNear", target: sim.headquarters.uid }]);
    emitted.length = 0;
    sim.setScriptMode("catchUp");
    teleport(actorOf(sim, second!), sim.headquarters.x + 2.5, sim.headquarters.z);
    advance(sim, 1);
    sim.endScriptCatchUp();
    advance(sim, 1);
    expect(proximityEvents(emitted)).toEqual([]);
    expect(valueOf(sim, "near")).toBe(3);
  }, 240_000);
});

describe("TRG4b came near a moving target (real simulation)", () => {
  it("fires when the distance to the unit in an actor variable drops inside the radius, once per approach", () => {
    const script = scriptOf({ near: near("cameNearMoving", variableTarget("a-target"), 3) });
    const { sim, soldiers } = garrisonIsland(script);
    const [first, second] = soldiers.map(uid => actorOf(sim, uid));
    teleport(first!, 30.5, 30.5);
    teleport(second!, 20.5, 20.5);
    advance(sim, 1);
    sim.script()!.engine.writeVariable("a-target", { type: "actor", value: [unit(first!.uid)] });
    const emitted = recordEmissions(sim);
    advance(sim, 1);
    expect(proximityEvents(emitted)).toEqual([]);
    // The subject walks up to the target …
    teleport(second!, 28.5, 30.5);
    tick(sim);
    expect(proximityEvents(emitted)).toEqual([{ id: second!.uid, kind: "cameNearMoving", target: first!.uid }]);
    tick(sim);
    // … the target walks away and back: the subject stands still, yet it is a new approach.
    teleport(first!, 40.5, 30.5);
    tick(sim);
    teleport(first!, 29.5, 31.5);
    tick(sim);
    expect(proximityEvents(emitted)).toHaveLength(2);
    expect(valueOf(sim, "near")).toBe(2);
    expect(storedOf(sim, "near")).toEqual([unit(second!.uid)]);
    // Both moving together stay near: nothing more.
    teleport(first!, 34.5, 34.5);
    teleport(second!, 35.5, 34.5);
    tick(sim);
    expect(proximityEvents(emitted)).toHaveLength(2);
  }, 240_000);
});

describe("TRG4b bridge stepped on (real simulation)", () => {
  it("every soldier marching over the deck steps onto it exactly once", () => {
    const script = scriptOf({ step: on("bridgeStepped") }, "triggeringActor");
    const [, river] = BRIDGE_SCENE_RIVERS[0]!;
    const { east, onDeck, simulation, west } = bridgeRiverScene(river, "wood", {}, world => { world.script = script; });
    const ids = Array.from({ length: 3 }, (_, index) => simulation.spawnDebugSoldier(
      { x: west.x - 6, z: west.z - 1 + index }, { rank: 0, type: "shield" })!.id);
    tick(simulation);
    const emitted = recordEmissions(simulation);
    expect(simulation.commandMilitary(ids, { x: east.x + 7, z: east.z }, "move")).toBe(true);
    const crossed = new Set<number>();
    for (let step = 0; step < 20 * 120; step++) {
      tick(simulation);
      for (const frame of simulation.frames()) if (ids.includes(frame.uid) && onDeck(frame)) crossed.add(frame.uid);
    }
    expect(crossed).toEqual(new Set(ids));
    const steps = emitted.filter(emission => emission.kind === "bridgeStepped");
    expect(steps.map(emission => emission.actors!.subject!.handle.id).sort()).toEqual([...ids].sort());
    expect(steps.every(emission => emission.responses!.triggeringActor !== undefined)).toBe(true);
    expect(new Set(steps.map(emission => emission.values!.bridgeId)).size).toBe(1);
    expect(valueOf(simulation, "step")).toBe(ids.length);
  }, 240_000);
});

describe("TRG4b proximity watch over a bare island", () => {
  const person = (uid: number, x: number, z: number) =>
    ({ job: "Carrier", phase: "walk", uid, visible: true, x, z }) as unknown as SettlementActor;
  const DECK: RoadSegment[] = [0, 1, 2, 3].map(tile => ({
    bridge: { id: 7, kind: "wood", tile, tiles: 4, width: 2 }, end: { x: 20.5 + tile * .5, z: 10 },
    start: { x: 20 + tile * .5, z: 10 }, tier: "stone"
  }) as unknown as RoadSegment);
  const SCRIPT = scriptOf({ moving: near("cameNearMoving", variableTarget("a-mover"), 2),
    near: near("cameNear", variableTarget("a-target"), 3), step: on("bridgeStepped") });

  /** A watch over plain people: targets come from `a-target` / `a-mover`, the one prop stands at (30.5, 30.5). */
  const bareWatch = (
    people: SettlementActor[], targets: ActorHandleValue[], live = { on: true }, movers: ActorHandleValue[] = []
  ) => {
    const context = { actors: people, buildings: [], options: { roads: { segments: () => DECK },
      world: { cellsX: 48, cellsZ: 48 } } } as unknown as SettlementContext;
    const emitted: ScriptEmission[] = [];
    const engine = { script: SCRIPT, state: { actors: {}, values: {
      "a-mover": { type: "actor", value: movers }, "a-target": { type: "actor", value: targets } } } };
    const prop = { actor: { family: "tree", handle: { generation: 0, id: 1, space: "prop" }, owner: null,
      type: "tree:pine" }, contained: false, hidden: false, x: 30.5, z: 30.5 };
    const members = { member: (handle: ActorHandleValue) => handle.space === "prop" ? prop : undefined,
      select: () => [] };
    const watch = createProximityWatch(context, {
      emit: emission => emitted.push(structuredClone(emission)), engine: () => engine as unknown as ScriptEngine,
      generations: new Map(), live: () => live.on, members: members as unknown as ScriptMembers
    })!;
    return { emitted, watch };
  };
  const PROP: ActorHandleValue = { generation: 0, id: 1, space: "prop" };
  const summary = (emitted: readonly ScriptEmission[]) => emitted.map(emission =>
    `${emission.kind}:${emission.actors!.subject!.handle.id}`);

  it("a circle around a prop: appearing inside counts, hiding inside and coming out is a new approach", () => {
    const walker = person(3, 10.5, 10.5);
    const people = [walker];
    const { emitted, watch } = bareWatch(people, [PROP]);
    const step = (change: () => void) => { change(); watch.update(); };
    step(() => { walker.x = 28.5; walker.z = 30.5; });
    step(() => { walker.x = 29.5; });
    step(() => { walker.visible = false; });
    step(() => { walker.visible = true; });
    step(() => { walker.x = 40.5; });
    expect(summary(emitted)).toEqual(["cameNear:3", "cameNear:3"]);
    expect(emitted[0]!.values).toEqual({ radius: 3 });
    // A newcomer created inside the circle approaches on its first sample; a retired shell never does.
    people.push(person(9, 30.5, 31.5), { ...person(11, 30.5, 30.5), phase: "retired" } as SettlementActor);
    emitted.length = 0;
    watch.update();
    expect(summary(emitted)).toEqual(["cameNear:9"]);
  });

  it("a target that appears or is assigned next to a standing unit announces nothing for the static circle", () => {
    const walker = person(3, 29.5, 30.5), targets: ActorHandleValue[] = [];
    const { emitted, watch } = bareWatch([walker], targets);
    watch.update();
    targets.push(PROP);
    watch.update();
    walker.x = 30.5;
    watch.update();
    expect(summary(emitted)).toEqual([]);
  });

  it("stepping onto the deck fires once, walking along it does not, a second step does", () => {
    const walker = person(3, 18.5, 10);
    const { emitted, watch } = bareWatch([walker], []);
    const step = (x: number, z = 10) => { walker.x = x; walker.z = z; watch.update(); };
    step(19.5);
    step(20.25);
    step(21.5, 10.4);
    step(22.5);
    step(21, 13);
    step(21);
    expect(summary(emitted)).toEqual(["bridgeStepped:3", "bridgeStepped:3"]);
    expect(emitted[0]!.values).toEqual({ bridgeId: 7 });
  });

  it("a reload in the middle of an approach continues identically (no saved state)", () => {
    const path: [number, number][] = [[10.5, 10.5], [19.5, 10], [20.5, 10], [26.5, 30.5], [28.5, 30.5], [29, 30.5],
      [36.5, 30.5], [30.5, 29.5], [21, 10.2], [21, 14]];
    const target = unit(5);
    const play = (reloadAt: number) => {
      const walker = person(3, ...path[0]!), mover = person(5, 44.5, 44.5);
      const people = [walker, mover];
      let run = bareWatch(people, [PROP], undefined, [target]);
      const all: string[] = [];
      path.forEach(([x, z], index) => {
        if (index === reloadAt) {
          all.push(...summary(run.emitted));
          run = bareWatch(people, [PROP], undefined, [target]);
        }
        walker.x = x; walker.z = z;
        mover.x = index >= 7 ? 31.5 : 44.5; mover.z = index >= 7 ? 29.5 : 44.5;
        run.watch.update();
      });
      return [...all, ...summary(run.emitted)];
    };
    const uninterrupted = play(-1);
    expect(uninterrupted).toEqual(["bridgeStepped:3", "cameNear:3", "cameNear:3", "cameNearMoving:3",
      "cameNear:5", "bridgeStepped:3"]);
    for (let reloadAt = 1; reloadAt < path.length; reloadAt++) expect(play(reloadAt)).toEqual(uninterrupted);
  });

  it("catch-up announces nothing; a script without proximity events builds no watch", () => {
    const walker = person(3, 10.5, 10.5), live = { on: false };
    const { emitted, watch } = bareWatch([walker], [PROP], live);
    walker.x = 29.5; walker.z = 30.5;
    watch.update();
    watch.reset();
    live.on = true;
    watch.update();
    expect(summary(emitted)).toEqual([]);
    const context = { actors: [], options: { world: { cellsX: 48, cellsZ: 48 } } } as unknown as SettlementContext;
    expect(createProximityWatch(context, { emit: () => {}, engine: () => ({ script: emptyScript() }) as ScriptEngine,
      generations: new Map(), live: () => true, members: {} as ScriptMembers })).toBeUndefined();
  });
});
