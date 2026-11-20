import { describe, expect, it } from "vitest";

import type { MapRegion } from "../../island-of-settlers-shared/src/campaign/campaign-regions";
import type { ScriptEmission } from "../../island-of-settlers-shared/src/script/types/emission";
import type { MapScript, ScriptEvent, ScriptTrigger } from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, num, numberVariable, ref, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { createCellWatch } from "../src/shared/script-world/cell-watch";
import {
  countIslandAction, countProducedWare, createActionCounters
} from "../src/shared/script-world/script-action-counters";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { advance, villageFixture } from "./helpers/military-assault-fixture";
import { actorOf, garrisonIsland, on, recordEmissions, teleport, tick } from "./helpers/script-watch-fixture";

/**
 * TRG4 region watch on real simulations: enter/leave exactly once per crossing, spawn inside, teleport, contained
 * people (door, deck), despawn, catch-up silence and reset, the entering unit as a run response, region filters
 * on event selectors and region waits that wake on the crossing tick.
 */

type Slots = ScriptEvent["slots"];

const rect = (id: string, minX: number, minZ: number, maxX: number, maxZ: number): MapRegion =>
  ({ id, name: id, shape: { kind: "rect", maxX, maxZ, minX, minZ } });

const inRegion = (kind: ScriptEvent["kind"], regionId: string) => on(kind, { region: ref("region", regionId) });

/** Counts its event and stores the entering unit (replacing the previous one) in `a-<id>`. */
const watcher = (id: string, event: ScriptEvent): ScriptTrigger => trigger(id, {
  actions: [
    doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", `v-${id}`) }),
    doStep("s2", "storeActor", { mode: str("replace"), selector: { key: "enteringActor", kind: "response" },
      variable: ref("variable", `a-${id}`) })
  ],
  events: [event]
});

const scriptOf = (regions: MapRegion[], watchers: Record<string, ScriptEvent>, extra: Partial<MapScript> = {}) =>
  emptyScript({
    regions,
    triggers: Object.entries(watchers).map(([id, event]) => watcher(id, event)),
    variables: Object.keys(watchers).flatMap(id => [numberVariable(`v-${id}`, id),
      { id: `a-${id}`, initial: { type: "actor", value: [] }, name: `a-${id}`, type: "actor" } as const]),
    ...extra
  });

const valueOf = (sim: SettlementSimulation, id: string) => sim.script()!.engine.state.values[`v-${id}`]?.value;
const storedOf = (sim: SettlementSimulation, id: string) => sim.script()!.engine.state.values[`a-${id}`]?.value;

const regionEvents = (emitted: readonly ScriptEmission[]) => emitted
  .filter(emission => emission.kind === "enteredRegion" || emission.kind === "leftRegion")
  .map(emission => ({ id: emission.actors!.subject!.handle.id, kind: emission.kind, region: emission.values!.region }));

const FAR = rect("region-far", 30, 30, 36, 36);
const EAST = rect("region-east", 40, 4, 44, 8);

describe("TRG4 region watch", () => {
  it("a walk in and out: one enter, one leave, the entering unit stored by the trigger", () => {
    const script = scriptOf([FAR, EAST], { entered: inRegion("enteredRegion", FAR.id),
      left: inRegion("leftRegion", FAR.id) });
    const { sim, soldiers } = garrisonIsland(script);
    const emitted = recordEmissions(sim);
    const [first] = soldiers;
    expect(sim.commandMilitary([first!], { x: 33, z: 33 }, "move")).toBe(true);
    for (let second = 0; second < 120 && valueOf(sim, "entered") === 0; second++) advance(sim, 1);
    advance(sim, 3);
    expect(valueOf(sim, "entered")).toBe(1);
    expect(storedOf(sim, "entered")).toEqual([{ generation: 0, id: first, space: "actor" }]);
    const entered = emitted.find(emission => emission.kind === "enteredRegion")!;
    expect(entered.responses).toMatchObject({ enteringActor: { id: first, space: "actor" },
      region: { type: "region", value: { id: FAR.id, kind: "region" } } });
    expect(entered.actors!.subject).toMatchObject({ owner: 0, type: "soldier:shield" });
    expect(sim.commandMilitary([first!], { x: 20, z: 20 }, "move")).toBe(true);
    for (let second = 0; second < 120 && valueOf(sim, "left") === 0; second++) advance(sim, 1);
    advance(sim, 3);
    expect(regionEvents(emitted)).toEqual([
      { id: first, kind: "enteredRegion", region: FAR.id }, { id: first, kind: "leftRegion", region: FAR.id }
    ]);
    expect(valueOf(sim, "left")).toBe(1);
  }, 240_000);

  it("teleports, two simultaneous entrants (one event each), overlapping regions and a despawn", () => {
    const INNER = rect("region-inner", 32, 32, 34, 34);
    const script = scriptOf([FAR, INNER, EAST], { east: inRegion("enteredRegion", EAST.id),
      entered: inRegion("enteredRegion", FAR.id), inner: inRegion("enteredRegion", INNER.id),
      left: inRegion("leftRegion", FAR.id) });
    const { sim, soldiers } = garrisonIsland(script);
    advance(sim, 1);
    const emitted = recordEmissions(sim);
    const [first, second] = soldiers.map(uid => actorOf(sim, uid));
    teleport(first!, 33.5, 33.5);
    teleport(second!, 30.5, 30.5);
    tick(sim);
    expect(regionEvents(emitted)).toEqual([
      { id: first!.uid, kind: "enteredRegion", region: FAR.id },
      { id: first!.uid, kind: "enteredRegion", region: INNER.id },
      { id: second!.uid, kind: "enteredRegion", region: FAR.id }
    ]);
    expect(valueOf(sim, "entered")).toBe(2);
    // Each run captured its own entrant: the last run stored the second soldier.
    expect(storedOf(sim, "entered")).toEqual([{ generation: 0, id: second!.uid, space: "actor" }]);
    emitted.length = 0;
    teleport(first!, 42.5, 6.5);
    tick(sim);
    expect(regionEvents(emitted)).toEqual([
      { id: first!.uid, kind: "leftRegion", region: FAR.id },
      { id: first!.uid, kind: "leftRegion", region: INNER.id },
      { id: first!.uid, kind: "enteredRegion", region: EAST.id }
    ]);
    emitted.length = 0;
    // A unit that leaves the world leaves its regions (after its gone event).
    sim.script()!.gone({ generation: 0, id: second!.uid, space: "actor" }, "died",
      { family: "soldier.melee", handle: { generation: 0, id: second!.uid, space: "actor" }, owner: 0,
        type: "soldier:shield" });
    expect(regionEvents(emitted)).toEqual([{ id: second!.uid, kind: "leftRegion", region: FAR.id }]);
  }, 240_000);

  it("real door traffic: each person alternates enter and leave at a region around the HQ door", () => {
    const { sim: probe } = villageFixture();
    const door = probe.headquarters.doorThreshold;
    const AT_DOOR = rect("region-door", Math.floor(door.x) - 2, Math.floor(door.z) - 2,
      Math.floor(door.x) + 3, Math.floor(door.z) + 3);
    const script = scriptOf([AT_DOOR], { entered: inRegion("enteredRegion", AT_DOOR.id),
      left: inRegion("leftRegion", AT_DOOR.id) });
    const { sim } = villageFixture(script);
    const emitted = recordEmissions(sim);
    advance(sim, 60);
    const events = regionEvents(emitted);
    const entered = events.filter(event => event.kind === "enteredRegion");
    expect(entered.length).toBeGreaterThan(0);
    // Every person's events alternate enter/leave, starting with an enter (a settler leaving the HQ appears).
    const byPerson = new Map<number, string[]>();
    for (const event of events) byPerson.set(event.id, [...byPerson.get(event.id) ?? [], event.kind]);
    for (const kinds of byPerson.values()) {
      kinds.forEach((kind, index) => expect(kind).toBe(index % 2 === 0 ? "enteredRegion" : "leftRegion"));
    }
    expect(valueOf(sim, "entered")).toBe(entered.length);
  }, 240_000);

  it("catch-up announces nothing and re-samples silently; live play continues from the new cells", () => {
    const script = scriptOf([FAR], { entered: inRegion("enteredRegion", FAR.id),
      left: inRegion("leftRegion", FAR.id) });
    const { sim, soldiers } = garrisonIsland(script);
    advance(sim, 1);
    const emitted = recordEmissions(sim);
    const actor = actorOf(sim, soldiers[0]!);
    sim.setScriptMode("catchUp");
    teleport(actor, 33.5, 33.5);
    expect(sim.commandMilitary([actor.uid], { x: 33, z: 33 }, "move")).toBe(true);
    advance(sim, 2);
    sim.endScriptCatchUp();
    advance(sim, 2);
    expect(regionEvents(emitted)).toEqual([]);
    teleport(actor, 20.5, 20.5);
    tick(sim);
    expect(regionEvents(emitted)).toEqual([{ id: actor.uid, kind: "leftRegion", region: FAR.id }]);
  }, 240_000);

  it("region filters on event selectors and region waits that wake on the crossing tick", () => {
    const soldiers = (region?: string) => ({ family: ref("family", "soldier"), kind: "family",
      ...(region ? { region: ref("region", region) } : {}) }) as unknown as Slots[string];
    const inFar = { args: { actor: { key: "triggeringActor", kind: "response" }, region: ref("region", FAR.id) },
      k: "is", pred: "actorInRegion" };
    const waiter = trigger("waiter", {
      actions: [
        { cond: inFar, id: "w1", k: "waitUntil", timeoutSeconds: null } as unknown as ScriptTrigger["actions"][number],
        doStep("s2", "setVariable", { value: num(1), variable: ref("variable", "v-woke") })
      ],
      events: [on("actorAppeared", { subject: soldiers() })], runLimit: 1
    });
    const base = scriptOf([FAR], {
      farAppeared: on("actorAppeared", { subject: soldiers(FAR.id) }),
      homeAppeared: on("actorAppeared", { subject: soldiers() })
    });
    const script = { ...base, triggers: [...base.triggers, waiter],
      variables: [...base.variables, numberVariable("v-woke", "woke")] };
    const { sim, soldiers: uids } = garrisonIsland(script);
    advance(sim, 1);
    expect(valueOf(sim, "homeAppeared")).toBe(2);
    expect(valueOf(sim, "farAppeared")).toBe(0);
    expect(valueOf(sim, "woke")).toBe(0);
    advance(sim, .5);
    for (const uid of uids) teleport(actorOf(sim, uid), 33.5, 33.5);
    tick(sim);
    // Not on a one-second boundary: the region dependency woke the wait on the crossing tick.
    expect(sim.script()!.engine.state.scriptTick % 20).not.toBe(0);
    expect(valueOf(sim, "woke")).toBe(1);
  }, 240_000);
});

describe("TRG4 contained people (watch over a bare island)", () => {
  const person = (uid: number, x: number, z: number) =>
    ({ job: "Carrier", phase: "walk", uid, visible: true, x, z }) as unknown as SettlementActor;

  it("hiding behind a door or riding a deck leaves; coming out enters the regions of the exit cell", () => {
    const walker = person(3, 33.5, 33.5), outsider = person(4, 5.5, 5.5);
    const context = { actors: [walker, outsider], options: { world: { cellsX: 48, cellsZ: 48 } } };
    const emitted: ScriptEmission[] = [], marked: string[] = [];
    const watch = createCellWatch(context as unknown as SettlementContext,
      scriptOf([FAR], { entered: inRegion("enteredRegion", FAR.id) }), {
        emit: emission => emitted.push(emission), generations: new Map(), isSubscribed: () => true,
        live: () => true, markRegion: id => marked.push(id)
      })!;
    const step = (change: () => void) => { change(); watch.update(); };
    step(() => { walker.visible = false; });
    step(() => { walker.visible = true; walker.x = 34.5; });
    step(() => { walker.phase = "navalAboard"; });
    // Landing outside the region announces nothing; walking in does, off the map counts as nowhere.
    step(() => { walker.x = 40.5; walker.phase = "walk"; });
    step(() => { walker.x = 33.5; });
    step(() => { walker.z = 99; });
    step(() => { walker.z = 33.5; });
    expect(regionEvents(emitted).map(event => event.kind)).toEqual(
      ["leftRegion", "enteredRegion", "leftRegion", "enteredRegion", "leftRegion", "enteredRegion"]);
    expect(regionEvents(emitted).every(event => event.id === walker.uid)).toBe(true);
    expect(marked).toHaveLength(6);
    // A newcomer standing inside enters on its first sample (spawn inside).
    context.actors.push(person(9, 31.5, 31.5));
    emitted.length = 0;
    watch.update();
    expect(regionEvents(emitted)).toEqual([{ id: 9, kind: "enteredRegion", region: FAR.id }]);
  });

  it("an island script that watches no region builds no cell lists", () => {
    const context = { actors: [], options: { world: { cellsX: 48, cellsZ: 48 } } };
    const host = { emit: () => {}, generations: new Map(), isSubscribed: () => true, live: () => true,
      markRegion: () => {} };
    expect(createCellWatch(context as unknown as SettlementContext, emptyScript({ regions: [FAR] }), host))
      .toBeUndefined();
  });
});

describe("TRG4 per-island action counters", () => {
  it("count island actions and produced wares (tools too) next to the unchanged home hooks", () => {
    const hooked: string[] = [];
    const context = { options: { onProduced: (ware: string) => hooked.push(`produced ${ware}`),
      onTutorialEvent: (key: string) => hooked.push(key) }, script: { counters: createActionCounters() } };
    const island = context as unknown as SettlementContext;
    countIslandAction(island, "plant");
    countIslandAction(island, "plant");
    countProducedWare(island, "axe");
    countProducedWare(island, "planks");
    expect(hooked).toEqual(["plant", "plant", "produced axe", "produced planks"]);
    expect(context.script.counters.save()).toEqual({ counters: { "plant": 2, "produce:axe": 1, "produce:planks": 1,
      "tools": 1 } });
    countIslandAction({ options: {} } as unknown as SettlementContext, "survey");
  });

  it("quest facts read the island's counters; they are saved and restored with the script run", () => {
    const { sim } = villageFixture(emptyScript());
    advance(sim, 1);
    expect(sim.saveState().scriptRun).not.toHaveProperty("counters");
    sim.script()!.counters.increment("plant");
    expect(sim.script()!.engine.port.questFacts!.counter("plant")).toBe(1);
    const saved = sim.saveState();
    expect(saved.scriptRun!.counters).toEqual({ plant: 1 });
    expect(sim.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
    expect(sim.script()!.engine.port.questFacts!.counter("plant")).toBe(1);
  }, 240_000);
});
