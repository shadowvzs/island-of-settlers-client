import type { RoadDecorationItemId } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { BUILD, MATERIAL, MATERIAL_COUNT } from "../../src/shared/world/world-data";

/** A full real map/save for the disposable API worker test, with deliberately flat empty test terrain. */
export const createRoadDecorationWorkerFixture = async (
  item: RoadDecorationItemId = "roadDecoration:indigenous-flower-pot:native"
) => {
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 0 });
  world.heights.fill(2); world.blocking.fill(0); world.walkCost.fill(10);
  world.buildClass.fill(BUILD.large); world.buildCap.fill(BUILD.large); world.slopeClass.fill(0);
  world.seaLevel = -1; world.props.count = 0; world.splat.fill(0); world.start = { x: 10, z: 10 };
  for (let index = 0; index < world.splat.length; index += MATERIAL_COUNT) world.splat[index + MATERIAL.grass] = 255;
  const roads = createRoadNetwork(world), simulation = createSettlementSimulation({ world, roads, initialSettlers: 0 });
  roads.addRoad({ x: 18, z: 10 }, { x: 18, z: 12 });
  const edge = roads.segments()[0]!;
  const candidates = [
    { x: (edge.start.x + edge.end.x) / 2 + 1, z: (edge.start.z + edge.end.z) / 2 },
    { x: 18, z: 18 }, { x: 21, z: 10 }, { x: 22, z: 18 }, { x: 18, z: 10 },
    { x: 10, z: 19 }, { x: 15, z: 19 }, { x: 20, z: 15 }, { x: 16, z: 16 }
  ];
  const position = candidates.find(point => simulation.planRoadDecoration({ item, position: point, yaw: 0 }).ok);
  if (!position) throw new Error(`No legitimate fixture position for ${item}`);
  const destination = candidates.find(point => Math.hypot(point.x - position.x, point.z - position.z) >= 2 &&
    simulation.planRoadDecoration({ item, position: point, yaw: 0 }).ok);
  if (!destination) throw new Error(`No legitimate fixture relocation for ${item}`);
  const game = await createGameSave(world, simulation.saveState(), { name: "Private road custody worker fixture",
    source: "generated", savedAt: 1_000_000, animals: [] });
  game.player = { ...createPlayerProgress(world.seed), inventory: { [item]: 1 } };
  return { destination, game, order: { item, position, yaw: 0 }, roads, simulation, world };
};
