import { entryByKey } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import type { ScriptEmission } from "../../island-of-settlers-shared/src/script/types/emission";
import type { MapScript } from "../../island-of-settlers-shared/src/script/types/index";
import {
  deerSpring, doStep, huntCounter, num, numberVariable, ref, seaStar, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { createIslandAnimals } from "../src/app/island-animals";
import { createIslandGrowth } from "../src/app/island-growth";
import { createIslandScriptNature } from "../src/app/settlement/island-script-nature";
import { getMeshKind } from "../src/render-common/props/prop-mesh-layout";
import { listShoreShellSpots } from "../src/render-common/props/shore-shell-spots";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { HOLD_TICKS } from "../src/render-common/wildlife/manager/animal-modes";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { tickSeconds } from "../src/shared/settlement/game-clock";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import type { WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";
import { forestWorld } from "./helpers/forest-world";
import { huntingWorld } from "./helpers/hunting-world";

/**
 * TRG3b nature events on real simulations with the real wildlife pool and the app-side nature source: the
 * design examples §14.1 (hunter kills a deer → counter), §14.6 (sea star picked up) and §14.7 (a deer enters the
 * spring region → its handle is stored), and a reused pool slot resolving an old handle to gone.
 */

const recordEmissions = (sim: SettlementSimulation) => {
  const engine = sim.script()!.engine, emitted: ScriptEmission[] = [];
  const original = engine.emit.bind(engine);
  engine.emit = emission => { if (engine.isSubscribed(emission.kind)) emitted.push(emission); original(emission); };
  return emitted;
};

const valueOf = (sim: SettlementSimulation, id: string) => sim.script()!.engine.state.values[id]?.value;

/** A flat island with the real wildlife manager and tree growth stepped at tick start, as the island hooks do. */
const natureIsland = (script: MapScript, world: WorldData = huntingWorld()) => {
  world.script = script;
  const animals = createIslandAnimals(world, createIslandNav(world, []));
  const growth = createIslandGrowth(world, () => true);
  const { manager } = animals;
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({
    consumeResource: target => target.kind === "carcass" || target.kind === "wildlife"
      ? manager.harvestCarcass(target.id) : undefined,
    getHuntTarget: id => {
      manager.ensureSimulated(id);
      const { pool } = manager.debug;
      if (!pool.carcass[id] && (!manager.isLiving(id) || !manager.isHuntable(id))) return null;
      return { collectible: manager.isCarcass(id), dead: Boolean(pool.carcass[id]),
        fleeing: pool.huntState[id] === 1, x: pool.x[id]!, z: pool.z[id]! };
    },
    hitHuntTarget: manager.hitHuntedAnimal, initialSettlers: 8, initialStock: { bow: 1, planks: 10 },
    onTickStart: (_dt, tick) => { growth.update(tickSeconds(tick)); manager.step(); },
    resourceTargets: (kind, near, range) => kind === "wildlife" || kind === "carcass"
      ? manager.listHuntTargets(kind, near, range) : undefined,
    roads, scriptNature: createIslandScriptNature(animals, growth), world
  });
  return { manager, simulation };
};

/** An adult deer standing at (x, z) at once (no fade-in), its pool slot. */
const placeDeer = (manager: ReturnType<typeof natureIsland>["manager"], x: number, z: number) => {
  expect(manager.placeAnimal(SPECIES.deer, x, z)).toBe(true);
  const { pool } = manager.debug;
  const slot = pool.active.findIndex((active, index) => active === 1 && pool.pending[index] === 1);
  pool.pending[slot] = 0; pool.appear[slot] = 1; manager.setAgeNormalized(slot, 1);
  return slot;
};

const huntAndSpring = (): MapScript => {
  const spring = deerSpring(), hunt = huntCounter();
  spring.regions[0]!.shape = { kind: "rect", maxX: 33, maxZ: 33, minX: 27, minZ: 27 };
  const gone = trigger("trigger-gone", {
    actions: [doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", "var-gone") })],
    events: [{ kind: "actorGone", player: { kind: "neutral" }, slots: {} }]
  });
  return { ...spring, triggers: [...spring.triggers, ...hunt.triggers, gone], variables: [...spring.variables,
    ...hunt.variables, numberVariable("var-gone", "gone")] };
};

describe("TRG3b nature events", () => {
  it("§14.7 a deer enters the spring, §14.1 the hunter kills it, a reused slot leaves the old handle gone", () => {
    const { manager, simulation } = natureIsland(huntAndSpring());
    const emitted = recordEmissions(simulation);
    const slot = placeDeer(manager, 30, 30);
    simulation.update(.05);
    const stored = { generation: 0, id: slot, space: "animal" };
    expect(valueOf(simulation, "var-deer")).toEqual([stored]);
    expect(emitted.find(emission => emission.kind === "enteredRegion")?.actors?.subject)
      .toMatchObject({ family: "animal.deer", owner: null, type: "animal:deer" });
    const port = simulation.script()!.engine.port;
    expect(port.isHandleLive(stored as never)).toBe(true);

    const placed = simulation.placeBuilding(22, 22, 22);
    expect(placed.ok, placed.reason).toBe(true);
    placed.building!.construction = 1; placed.building!.foundationProgress = 1;
    expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
    for (let step = 0; step < 12_000 && valueOf(simulation, "var-1") === 0; step++) simulation.update(.05);
    simulation.update(.05);
    expect(valueOf(simulation, "var-1")).toBe(1);
    const kills = emitted.filter(emission => emission.kind === "animalKilled");
    expect(kills).toHaveLength(1);
    expect(kills[0]!.actors).toMatchObject({ killer: { owner: 0, type: "settler:hunter" },
      victim: { handle: stored, type: "animal:deer" } });
    const gone = emitted.filter(emission => emission.kind === "actorGone");
    expect(gone.map(emission => emission.values?.reason)).toEqual(["died"]);
    expect(emitted.findIndex(emission => emission.kind === "animalKilled"))
      .toBeLessThan(emitted.findIndex(emission => emission.kind === "actorGone"));
    // The kill released the variable (owner 28) and the old handle is gone.
    expect(valueOf(simulation, "var-deer")).toEqual([]);
    expect(port.isHandleLive(stored as never)).toBe(false);

    // The carcass goes; a new deer takes the same slot under the next generation.
    manager.harvestCarcass(slot);
    manager.debug.pool.carcass[slot] = 0;
    expect(placeDeer(manager, 31, 31)).toBe(slot);
    expect(port.isHandleLive(stored as never)).toBe(false);
    expect(port.isHandleLive({ ...stored, generation: 1 } as never)).toBe(true);
    expect(simulation.saveState().scriptRun?.nature).toEqual({ animal: [slot, 1] });
  }, 240_000);

  it("§14.6 picking up a sea star completes the quest once; the shell's next incarnation is a new handle", () => {
    const world = structuredClone(cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96,
      erosionDroplets: 4000 }));
    const { simulation } = natureIsland(seaStar(), world);
    const emitted = recordEmissions(simulation);
    const kinds = listShoreShellSpots(world).map(spot => getMeshKind(spot.meshId));
    const seaStarIndex = kinds.indexOf(entryByKey("shell", "seaStar")!.code);
    const other = kinds.findIndex(kind => kind !== entryByKey("shell", "seaStar")!.code);
    expect(seaStarIndex).toBeGreaterThanOrEqual(0);
    // The quest activates on the one-second cadence.
    for (let step = 0; step < 30; step++) simulation.update(.05);
    expect(simulation.collectShoreShell(other)).not.toBeNull();
    simulation.update(.05);
    expect(simulation.script()!.engine.state.quests["q-beachcomber"]?.state).not.toBe("succeeded");
    expect(simulation.collectShoreShell(seaStarIndex)).not.toBeNull();
    simulation.update(.05);
    expect(simulation.script()!.engine.state.quests["q-beachcomber"]?.state).toBe("succeeded");
    expect(simulation.script()!.engine.state.firedCounts["trigger-9"]).toBe(1);
    const picked = emitted.filter(emission => emission.kind === "shellPickedUp");
    expect(picked.map(emission => emission.actors?.shell?.type)[1]).toBe("shell:seaStar");
    expect(picked[1]).toMatchObject({ player: 0, responses: { targetActor: { generation: 0, id: seaStarIndex,
      space: "shell" } } });
    const port = simulation.script()!.engine.port;
    expect(port.isHandleLive({ generation: 0, id: seaStarIndex, space: "shell" })).toBe(false);
    expect(port.isHandleLive({ generation: 1, id: seaStarIndex, space: "shell" })).toBe(true);
  }, 120_000);

  it("pinned habitat regions wake at once and never sleep; a reload's re-pin changes nothing", () => {
    const settled = () => {
      const animals = createAnimalManager(forestWorld(96, 1.8), createIslandNav(forestWorld(96, 1.8), []));
      for (let tick = 0; tick < 200; tick++) animals.step();
      return animals;
    };
    const pinned = settled(), free = settled();
    expect(pinned.countSimulatedRegions()).toBe(0);
    pinned.script.pinCells([{ maxX: 16, maxZ: 16, minX: 14, minZ: 14 }]);
    const awake = pinned.countSimulatedRegions();
    expect(awake).toBeGreaterThan(0);
    const before = JSON.stringify(pinned.saveState());
    pinned.script.pinCells([{ maxX: 16, maxZ: 16, minX: 14, minZ: 14 }]);
    expect(JSON.stringify(pinned.saveState())).toBe(before);
    for (let tick = 0; tick < HOLD_TICKS * 2; tick++) { pinned.step(); free.step(); }
    expect(pinned.countSimulatedRegions()).toBe(awake);
    expect(free.countSimulatedRegions()).toBe(0);
    pinned.script.pinCells([]);
    for (let tick = 0; tick < HOLD_TICKS; tick++) pinned.step();
    expect(pinned.countSimulatedRegions()).toBe(0);
  });
});
