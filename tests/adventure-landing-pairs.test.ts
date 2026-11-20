import { describe, expect, it, vi } from "vitest";

import { SHIP_DECK } from "../src/render-common/ships/ship-deck-layout";
import { deckWay, wayLength } from "../src/render-common/ships/ship-deck-way";
import { adventureOffers } from "../src/shared/settlement/adventure-rules";
import { chooseAdventureWorld } from "../src/shared/settlement/colony-world-choice";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import {
  ADVENTURE_ABOARD, ADVENTURE_GANGWAY, ADVENTURE_LANDING_PHASES
} from "../src/shared/settlement/settlement-adventure-landing";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

type Simulation = ReturnType<typeof createSettlementSimulation>;
const STEP = .05;

const createLanding = () => {
  const island = adventureOffers(1234).find(offer => offer.difficulty === "easy")!;
  const world = chooseAdventureWorld(island);
  let simulation: Simulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ homeBuilding: null, initialSettlers: 0, roads, world });
  return { island, simulation };
};

const footLanding = (count: number) => {
  const { island, simulation } = createLanding();
  const troops = Array.from({ length: count }, () => ({ hp: 100, rank: 0, type: "heavy" as const }));
  expect(simulation.startAdventure({ island, troops }).ok).toBe(true);
  const ids = new Set(simulation.militarySoldiers().filter(soldier => !soldier.combat?.faction)
    .map(soldier => soldier.actor));
  return { ids, simulation };
};

const landers = (simulation: Simulation, ids: ReadonlySet<number>) => simulation.frames()
  .filter(actor => ids.has(actor.uid) && ADVENTURE_LANDING_PHASES.includes(actor.phase));

/** The closest two visible soldiers still aboard or on the gangway (tiles). */
const closest = (simulation: Simulation, ids: ReadonlySet<number>) => {
  const bodies = landers(simulation, ids).filter(actor => actor.visible);
  let gap = Infinity;
  for (const [index, body] of bodies.entries())
    for (const other of bodies.slice(index + 1)) gap = Math.min(gap, Math.hypot(body.x - other.x, body.z - other.z));
  return gap;
};

/** Runs until every soldier is ashore: seconds taken, closest approach and when each stepped on the gangway. */
const land = (simulation: Simulation, ids: ReadonlySet<number>, limit = 60) => {
  const steps: number[] = [], onGangway = new Set<number>();
  let gap = Infinity, time = 0;
  for (; time < limit && landers(simulation, ids).length; time += STEP) {
    simulation.update(STEP);
    gap = Math.min(gap, closest(simulation, ids));
    for (const actor of simulation.frames())
      if (ids.has(actor.uid) && actor.phase === ADVENTURE_GANGWAY && !onGangway.has(actor.uid)) {
        onGangway.add(actor.uid);
        steps.push(time);
      }
  }
  return { gap, steps, time };
};

describe("adventure landing two at a time (owner, 2026-10-15)", () => {
  it("lands 14 foot soldiers in about 14 s, in pairs and without overlapping", () => {
    const { ids, simulation } = footLanding(14);
    const { gap, steps, time } = land(simulation, ids);
    expect(time).toBeLessThan(15.5);
    expect(time).toBeGreaterThan(12);
    expect(gap).toBeGreaterThanOrEqual(.5);
    // A pair's second soldier follows closer than the next pair follows it.
    const intervals = steps.slice(1).map((step, index) => step - steps[index]!);
    const partners = intervals.filter((_, index) => index % 2 === 0);
    const pairs = intervals.filter((_, index) => index % 2 === 1);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(partners)).toBeLessThan(mean(pairs));
  }, 60000);

  it("walks round the hatch and the mast foot", () => {
    const { hatch, mast } = SHIP_DECK;
    const from = { x: hatch.minX - .1, z: (hatch.minZ + hatch.maxZ) / 2 }, to = { x: .42, z: -.1 };
    const way = deckWay(from, to);
    expect(way.length).toBeGreaterThan(1);
    expect(way.at(-1)).toEqual(to);
    expect(wayLength(from, way)).toBeLessThan(2);
    way.forEach((point, index) => {
      const previous = index ? way[index - 1]! : from;
      for (let share = 0; share <= 1; share += .01) {
        const x = previous.x + (point.x - previous.x) * share, z = previous.z + (point.z - previous.z) * share;
        expect(x > hatch.minX && x < hatch.maxX && z > hatch.minZ && z < hatch.maxZ).toBe(false);
        expect(Math.hypot(x - mast.x, z - mast.z)).toBeGreaterThan(mast.radius);
      }
    });
    expect(deckWay({ x: .2, z: .5 }, to)).toEqual([to]);
  });

  it("resumes a landing saved with soldiers on the deck and the gangway", () => {
    const { ids, simulation } = footLanding(14);
    const busy = () => {
      const bodies = landers(simulation, ids);
      return bodies.filter(actor => actor.phase === ADVENTURE_GANGWAY).length >= 2 &&
        bodies.some(actor => actor.phase === ADVENTURE_ABOARD && actor.path.length > 0);
    };
    let time = 0;
    for (; time < 30 && !busy(); time += STEP) simulation.update(STEP);
    expect(busy()).toBe(true);
    const saved = simulation.saveState();
    const loaded = createLanding().simulation;
    expect(loaded.loadState(saved).ok).toBe(true);
    for (const actor of landers(simulation, ids))
      expect(loaded.frames().find(body => body.uid === actor.uid)).toMatchObject({
        phase: actor.phase, visible: actor.visible, x: actor.x, y: actor.y, z: actor.z
      });
    const rest = land(loaded, ids);
    expect(rest.gap).toBeGreaterThanOrEqual(.5);
    expect(time + rest.time).toBeLessThan(16);
    expect(loaded.saveState().adventure!.landing!.ashore).toBe(14);
  }, 60000);
});
