import { adventureOffers } from "../../src/shared/settlement/adventure-rules";
import { chooseAdventureWorld } from "../../src/shared/settlement/colony-world-choice";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { landingBodies, landingClearance, stillLanding } from "../../tests/helpers/landing-clearance";

/**
 * Adventure landing times on the generated easy island (seed 1234): seconds until every soldier
 * has left the ship and the gangway, and the least clearance between two bodies aboard or on the
 * gangway (riders and horses on deck as horse-sized bodies; negative would be an overlap).
 * Usage: npx tsx tools/bench/adventure-landing-time.ts
 */
type TroopType = "cavalry" | "heavy";
const CASES: ReadonlyArray<{ label: string; types: (index: number) => TroopType; count: number }> = [
  { count: 14, label: "14 foot soldiers", types: () => "heavy" },
  { count: 8, label: "8 mixed (2 riders, horses on deck)", types: index => index < 6 ? "heavy" : "cavalry" },
  { count: 6, label: "6 mixed (3 riders)", types: index => index % 2 ? "cavalry" : "heavy" },
  { count: 30, label: "30 mixed (5 riders)", types: index => index % 6 ? "heavy" : "cavalry" },
  { count: 50, label: "50 riders", types: () => "cavalry" }
];
const STEP = .05;

const closest = (simulation: ReturnType<typeof createSettlementSimulation>, ids: ReadonlySet<number>) => {
  let gap = Infinity;
  const bodies = landingBodies(simulation, ids);
  for (const [index, body] of bodies.entries())
    for (const other of bodies.slice(index + 1)) gap = Math.min(gap, landingClearance(body, other));
  return gap;
};

for (const { count, label, types } of CASES) {
  const island = adventureOffers(1234).find(offer => offer.difficulty === "easy")!;
  const world = chooseAdventureWorld(island);
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ homeBuilding: null, initialSettlers: 0, roads, world });
  const troops = Array.from({ length: count }, (_, index) => ({ hp: 100, rank: 0, type: types(index) }));
  if (!simulation.startAdventure({ island, troops }).ok) throw new Error(`${label}: no landing`);
  const ids = new Set(simulation.militarySoldiers().filter(soldier => !soldier.combat?.faction)
    .map(soldier => soldier.actor));
  let gap = Infinity, time = 0;
  for (; time < 600 && stillLanding(simulation, ids); time += STEP) {
    simulation.update(STEP);
    gap = Math.min(gap, closest(simulation, ids));
  }
  console.log(`${label}: ${time.toFixed(1)} s, least clearance ${gap.toFixed(2)} tiles`);
}
