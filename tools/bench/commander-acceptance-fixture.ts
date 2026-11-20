import { openLocalSaveStore } from "../../src/app/save-store/local-save-store";
import { settingsStorage } from "../../src/app/settings/graphics-settings";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { commanderRecruitCost } from "../../src/shared/settlement/settlement-commander";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";

/** A reproducible level-13 home island with a real lodge site, harbour, idle ship and stored troops. */
export interface CommanderAcceptanceFixtureOptions {
  /** Complete the lodge in the fixture instead of leaving its real construction to the live page. */
  completeLodge?: boolean;
  nation?: "japanese" | "nubian" | "roman" | "viking";
  seed?: number;
  size?: number;
  /** Exercise mounted lodge exit beside a complete surrounding public-road loop. */
  surroundLodgeRoads?: boolean;
}

export interface CommanderAcceptanceFixture {
  berth: { x: number; z: number; y: number };
  harbour: { uid: number; x: number; z: number };
  lodge: { construction: number; required: Record<string, number>; uid: number; x: number; z: number };
  nation: string;
  seed: number;
  ships: number;
  stock: Record<string, number>;
  stored: Array<{ count: number; type: string }>;
}

const aligned = (value: number, size: number) =>
  size % 2 === 0 ? Math.round(value) : Math.round(value) + .5;

const lodgeRoadLoop = (lodge: SettlementBuilding) => {
  const dx = lodge.width / 2 + 1.5, dz = lodge.depth / 2 + 1.5;
  const corners = [
    { x: lodge.x - dx, z: lodge.z - dz }, { x: lodge.x + dx, z: lodge.z - dz },
    { x: lodge.x + dx, z: lodge.z + dz }, { x: lodge.x - dx, z: lodge.z + dz }
  ];
  return corners.flatMap((from, index) => {
    const to = corners[(index + 1) % corners.length]!;
    const steps = Math.round(Math.hypot(to.x - from.x, to.z - from.z) * 2);
    return Array.from({ length: steps }, (_, step) => ({
      a: { x: from.x + (to.x - from.x) * step / steps, z: from.z + (to.z - from.z) * step / steps },
      b: { x: from.x + (to.x - from.x) * (step + 1) / steps,
        z: from.z + (to.z - from.z) * (step + 1) / steps }
    }));
  });
};

/**
 * Creates and stores the startup save for the native commander acceptance run. A browser-only
 * benchmark helper: it never touches production files or behaviour outside the usual save store.
 */
export const createCommanderAcceptanceFixture = async (
  options: CommanderAcceptanceFixtureOptions = {}
): Promise<CommanderAcceptanceFixture> => {
  const { completeLodge = false, nation = "viking", seed = 1234, size = 96, surroundLodgeRoads = false } = options;
  settingsStorage.writeFog(false);
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size,
    erosionDroplets: 100, islandCount: 1, mountains: 0, rivers: 0, seed });
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, {
    isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) ?? false
  });
  simulation = createSettlementSimulation({
    developmentAllowed: true, initialSettlers: 30, initialStock: {
      ...commanderRecruitCost(nation), beer: 20, coins: 50, hammer: 2, planks: 100, shield: 20, shovel: 2, stone: 100, sword: 20
    }, playerLevel: () => 13, playerNation: nation, roads, world
  });
  const home = simulation.headquarters;
  const findPlot = (typeId: number, complete: boolean, root = home, minimumRadius = 5) => {
    const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
    for (let radius = minimumRadius; radius < 45; radius++) for (let step = 0; step < 64; step++) {
      const angle = step * Math.PI / 32 + (surroundLodgeRoads && typeId === 62 ? Math.PI : 0);
      const x = aligned(root.x + Math.cos(angle) * radius, width);
      const z = aligned(root.z + Math.sin(angle) * radius, depth);
      const placed = simulation.placeBuilding(typeId, x, z);
      if (!placed.ok || !placed.building) continue;
      if (complete) Object.assign(placed.building, {
        construction: 1, foundationProgress: 1, required: {}
      });
      if (!simulation.connectRoads(home.access, placed.building.access)) {
        simulation.demolishBuilding(placed.building.uid);
        continue;
      }
      if (surroundLodgeRoads && typeId === 62 &&
        lodgeRoadLoop(placed.building).some(({ a, b }) => !simulation.planRoad(a, b, "dirt"))) {
        simulation.demolishBuilding(placed.building.uid);
        continue;
      }
      return placed.building;
    }
    throw new Error(`No road-connected plot for building ${typeId}`);
  };
  const lodge = findPlot(62, completeLodge, home, surroundLodgeRoads ? 8 : 5);
  if (surroundLodgeRoads) {
    const dx = lodge.width / 2 + 1.5, dz = lodge.depth / 2 + 1.5;
    const corners = [
      { x: lodge.x - dx, z: lodge.z - dz }, { x: lodge.x + dx, z: lodge.z - dz },
      { x: lodge.x + dx, z: lodge.z + dz }, { x: lodge.x - dx, z: lodge.z + dz }
    ];
    for (let index = 0; index < corners.length; index++) {
      const a = corners[index]!, b = corners[(index + 1) % corners.length]!;
      if (!simulation.connectRoads(a, b) && !roads.route(a, b))
        throw new Error(`Commander road loop refused ${JSON.stringify({ a, b })}`);
    }
  }
  let harbour: ReturnType<typeof findPlot> | null = null;
  const [harbourWidth, harbourDepth] = getBuildingDefinition(39).gridFootprint;
  for (let radius = 6; radius < 50 && !harbour; radius++) for (let step = 0; step < 64 && !harbour; step++) {
    const angle = step * Math.PI / 32;
    const x = aligned(home.x + Math.cos(angle) * radius, harbourWidth);
    const z = aligned(home.z + Math.sin(angle) * radius, harbourDepth);
    if (simulation.harbourBerthPreview(39, x, z) === null) continue;
    const placed = simulation.placeBuilding(39, x, z);
    if (!placed.ok || !placed.building) continue;
    Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
    if (!simulation.connectRoads(home.access, placed.building.access)) {
      simulation.demolishBuilding(placed.building.uid);
      continue;
    }
    harbour = placed.building;
  }
  if (!harbour) throw new Error("No harbour plot with a berth");
  for (let tick = 0; tick < 20; tick++) simulation.update(1);
  const berths = simulation.harbourBerths(harbour.uid);
  if (!berths.length) throw new Error("The harbour has no ship berth");
  simulation.startMilitaryTrainingEncounter();
  const saved = simulation.saveState();
  const hostile = new Set(saved.military!.soldiers.filter(soldier => (soldier.combat?.faction ?? 0) > 0)
    .flatMap(soldier => [soldier.actor, soldier.combat?.mount]));
  saved.military!.soldiers = saved.military!.soldiers.filter(soldier => !hostile.has(soldier.actor));
  saved.actors = saved.actors.filter(actor => !hostile.has(actor.uid));
  const berth = { x: berths[0]!.x, y: world.seaLevel, z: berths[0]!.z };
  saved.naval.fleet.ships.push({ cargo: {}, cargoCount: 0, cursor: 0, id: 1, phase: "idle", route: [],
    timer: 0, x: berth.x, y: berth.y, yaw: berths[0]!.yaw ?? 0, z: berth.z });
  saved.naval.fleet.nextShip = 2;
  const game = await createGameSave(world, saved,
    { animals: [], name: "Commander acceptance", savedAt: 123, source: "generated" });
  game.player = { ...createPlayerProgress(world.seed), experience: 1200 };
  const storable = await openLocalSaveStore();
  await storable.writeStartupGame(JSON.stringify(game));
  return {
    berth,
    harbour: { uid: harbour.uid, x: harbour.x, z: harbour.z },
    lodge: { construction: lodge.construction, required: { ...lodge.required }, uid: lodge.uid,
      x: lodge.x, z: lodge.z },
    nation,
    seed: world.seed,
    ships: saved.naval.fleet.ships.length,
    stock: { ...home.inventory },
    stored: simulation.militaryStoredTroops().map(entry => ({ count: entry.count, type: entry.type }))
  };
};
