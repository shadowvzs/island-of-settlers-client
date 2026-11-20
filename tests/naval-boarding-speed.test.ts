import { describe, expect, it } from "vitest";

import { RUN_SPEED } from "../src/render-common/workers/worker-gait";
import { BOARDING_FILE } from "../src/shared/settlement/settlement-naval-passengers";
import { edgeBaySettlement, edgeBayWorld } from "./helpers/edge-bay-settlement";

type Simulation = ReturnType<typeof edgeBaySettlement>;
const PASSAGE = new Set(["navalToShip", "navalBoarding", "navalDeckWalk"]);
/** Pier and deck: where people walk in file and must never stand on one another. */
const OVER_WATER = new Set(["navalBoarding", "navalDeckWalk"]);
const TICK = .05;

const firstShip = (simulation: Simulation) => simulation.ships().find(ship => !ship.visitor && ship.passengers > 0);
const onPassage = (simulation: Simulation) => simulation.snapshot().actors.filter(actor => PASSAGE.has(actor.phase));
const closestPair = (people: readonly { x: number; z: number }[]) => people.reduce((closest, one, index) =>
  people.slice(index + 1).reduce((nearest, other) =>
    Math.min(nearest, Math.hypot(one.x - other.x, one.z - other.z)), closest), Infinity);

describe("boarding two at a time (owner, 2026-10-15)", () => {
  it("brings 16 foot soldiers aboard a colony ship (running) in about a minute and a half, two in file, never overlapping", () => {
    const simulation = edgeBaySettlement();
    expect(simulation.startDebugExpedition("colony")).toMatchObject({ ok: true });
    let loading = 0, most = 0, nearest = Infinity, portersWhileBoarding = false;
    const paces = { soldiers: new Set<number>(), walkers: new Set<number>() };
    for (let step = 0; step < 8000; step++) {
      simulation.update(TICK);
      const ship = firstShip(simulation);
      if (ship?.phase === "sailing" && loading) break;
      if (ship?.phase !== "loading") continue;
      loading += TICK;
      const people = onPassage(simulation);
      most = Math.max(most, people.length);
      nearest = Math.min(nearest, closestPair(people.filter(actor => OVER_WATER.has(actor.phase))));
      // Soldiers run over the pier and deck (NAV-04); anyone else walks.
      for (const actor of people) if (actor.action === "walk" && OVER_WATER.has(actor.phase))
        paces[actor.job === "Soldier" ? "soldiers" : "walkers"].add(Math.round((actor.locomotionSpeed ?? 0) * 100));
      const frame = simulation.shipFrames().find(entry => entry.id === ship.id);
      portersWhileBoarding ||= Boolean(frame?.cargoWork) && ship.aboardPassengers < ship.passengers;
    }
    expect(firstShip(simulation)?.passengers).toBe(16);
    expect(loading).toBeGreaterThan(60);
    expect(loading).toBeLessThan(110);
    expect(most).toBe(BOARDING_FILE);
    expect(nearest).toBeGreaterThan(.28);
    expect(portersWhileBoarding).toBe(false);
    expect([...paces.soldiers]).toEqual([Math.round(RUN_SPEED * 100)]);
    expect(Math.max(...paces.walkers)).toBeLessThan(RUN_SPEED * 100);
  }, 60000);

  it("carries on boarding after a save with two people on the pier", () => {
    const simulation = edgeBaySettlement();
    expect(simulation.startDebugExpedition("colony")).toMatchObject({ ok: true });
    for (let step = 0; step < 6000 && onPassage(simulation).length < BOARDING_FILE; step++) simulation.update(TICK);
    expect(onPassage(simulation)).toHaveLength(BOARDING_FILE);
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    const restored = edgeBaySettlement(edgeBayWorld());
    expect(restored.loadState(saved)).toEqual({ ok: true });
    expect(onPassage(restored)).toHaveLength(BOARDING_FILE);
    for (let step = 0; step < 6000 && firstShip(restored)?.phase !== "sailing"; step++) restored.update(TICK);
    const ship = firstShip(restored)!;
    expect(ship.phase).toBe("sailing");
    expect(ship.aboardPassengers).toBe(ship.passengers);
  }, 60000);
});
