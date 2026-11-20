import { describe, expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { PROP } from "../src/shared/world/world-data";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld } from "./helpers/hunting-world";
import { troops } from "./helpers/military-assault-fixture";

const AI = 2;
const AI_SETTLERS = 4;
const HEADQUARTERS = 0;
const WOODCUTTER = 17;
const TREES: readonly (readonly [number, number])[] = [[53, 40], [56, 39], [59, 40], [62, 41], [57, 42]];

/** The player's HQ at (10, 10); the economy faction's HQ (debug start kit) and woodcutter site in the east. */
const twoOwnerIsland = () => {
  const world = huntingWorld();
  world.props.count = TREES.length;
  world.props.types.fill(PROP.coniferTree, 0, TREES.length);
  TREES.forEach(([x, z], index) => { world.props.x[index] = x; world.props.z[index] = z; });
  world.props.scale.fill(1);
  world.scenario = economyCampaignScenario([AI]);
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 8, homeBuilding: 0,
    canWorkerEnterPlot: () => true });
  const depot = simulation.aiPlace(AI, { typeId: HEADQUARTERS, x: 47, z: 46 }, { settlers: AI_SETTLERS,
    stock: { axe: 1, hammer: 2, logs: 12, planks: 12, stone: 12 } });
  expect(depot.ok, depot.reason).toBe(true);
  return { depot: depot.building!, roads, simulation };
};

/** Every person keeps to its own economy: no player person serves an AI building, and the reverse. */
const crossServed = (buildings: ReadonlyMap<number, SettlementBuilding>, actor: SettlementActor) => {
  if (actor.phase === "retired" || actor.job === "Soldier" || actor.job === "Mount") return false;
  const ai = actor.hostileCivilianFaction === AI;
  return [actor.home, actor.building, actor.delivery?.source, actor.delivery?.destination]
    .map(uid => uid === undefined ? undefined : buildings.get(uid))
    .some(building => building !== undefined && (building.militaryFaction === AI) !== ai);
};

/** EAI1c step c8: one AI depot and one woodcutter of an economy faction, road-joined to the player. */
describe("two-owner economy fixture", () => {
  it("builds, staffs and runs the AI woodcutter with AI people and AI stock only", () => {
    const { depot, roads, simulation } = twoOwnerIsland();
    const placed = simulation.placeFactionBuilding(AI, { typeId: WOODCUTTER, x: 56, z: 47 });
    expect(placed.ok, placed.reason).toBe(true);
    const woodcutter = placed.building!;
    expect(woodcutter.militaryFaction).toBe(AI);
    // Both entrances face +z: the AI road runs in front of the depot and the woodcutter.
    expect(simulation.connectFactionRoads(AI, depot.access, woodcutter.access)).toBeTruthy();
    // The two road networks touch: only the owner rule keeps the economies apart.
    expect(roads.addRoad(simulation.headquarters.access, depot.access)).toBeTruthy();
    const playerPeople = simulation.availableSettlers() - simulation.settlerBirths();
    // The empty authored map is won on the first tick (no enemy), paying its reward of 0 coins.
    const playerStock = { coins: 0, ...simulation.headquarters.inventory };
    const buildings = new Map(simulation.buildings().map(building => [building.uid, building]));
    // The site takes its logs from the depot; a felled log carried in shows as a rise above the low point.
    let crossings = 0, lowest = depot.inventory.logs!, logsDelivered = false;
    for (let step = 0; step < 20 * 900 && !logsDelivered; step++) {
      simulation.update(.05);
      if (step % 5 === 0)
        for (const actor of simulation.snapshot().actors) if (crossServed(buildings, actor)) crossings++;
      lowest = Math.min(lowest, depot.inventory.logs ?? 0);
      logsDelivered = woodcutter.construction === 1 && (depot.inventory.logs ?? 0) > lowest;
    }
    expect(logsDelivered).toBe(true);
    expect(crossings).toBe(0);
    const actors = simulation.snapshot().actors;
    expect(actors.find(actor => actor.uid === woodcutter.worker)?.hostileCivilianFaction).toBe(AI);
    // The player's people and stock are untouched (births aside); the AI's people stay in its economy.
    expect(simulation.availableSettlers() - simulation.settlerBirths()).toBe(playerPeople);
    expect(simulation.headquarters.inventory).toEqual(playerStock);
    const aiPeople = actors.filter(actor => actor.phase !== "retired" && actor.hostileCivilianFaction === AI);
    expect(aiPeople.map(actor => actor.job)).toContain("Woodcutter");
    expect(aiPeople.length + (depot.idleSettlers ?? 0)).toBe(AI_SETTLERS);
  });

  it("saves and reloads an economy depot with settlers (the saved total is the player's)", () => {
    const { simulation } = twoOwnerIsland();
    const saved = simulation.saveState();
    const { simulation: reloaded } = twoOwnerIsland();
    expect(reloaded.loadState(saved)).toEqual({ ok: true });
  });

  it("lets a player siege order on an undefended economy building fail safely (no door assumed)", () => {
    const { simulation } = twoOwnerIsland();
    const placed = simulation.placeFactionBuilding(AI, { typeId: WOODCUTTER, x: 56, z: 47 });
    const site = Object.assign(placed.building!, { construction: 1, required: {} });
    simulation.receiveTroops(troops("heavy", 3));
    const ids = simulation.militarySoldiers().map(soldier => soldier.actor);
    simulation.callOutMilitary(["heavy"], { x: 20, z: 20 });
    for (let step = 0; step < 20 * 20; step++) simulation.update(.05);
    // Without a door the order is refused (EAI1b E5 keeps economy sites doorless); nothing reaches the capture.
    expect(ids.length).toBe(3);
    expect(simulation.siegeMilitary(ids, site.uid)).toBe(false);
    expect(() => { for (let step = 0; step < 20 * 60; step++) simulation.update(.05); }).not.toThrow();
    expect(site.militaryFaction).toBe(AI);
  }, 120_000);
});
