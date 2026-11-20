import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { BUILD, FOG, MATERIAL, MATERIAL_COUNT } from "../../src/shared/world/world-data";

/** Finite, validated isolated account checkpoint. Never mutates an owner's save. */
export const createRecoveryAccountFixture = async () => {
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 0 });
  world.heights.fill(2); world.blocking.fill(0); world.walkCost.fill(10);
  world.buildClass.fill(BUILD.large); world.buildCap.fill(BUILD.large); world.slopeClass.fill(0);
  world.seaLevel = -1; world.props.count = 0; world.fog.fill(FOG.visible); world.splat.fill(0);
  for (let index = 0; index < world.splat.length; index += MATERIAL_COUNT)
    world.splat[index + MATERIAL.grass] = 255;
  world.start = { x: 10, z: 10 };
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ initialSettlers: 20, playerLevel: () => 23, roads, world,
    initialStock: { beer: 40, coins: 40, planks: 40, shield: 6, stone: 40, sword: 6, wine: 40 } });
  const [width, depth] = getBuildingDefinition(62).gridFootprint;
  const placed = simulation.placeBuilding(62, 26 + width / 2, 22 + depth / 2);
  assert(placed.ok && placed.building, placed.reason ?? "Commander lodge placement failed");
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  roads.addRoad(simulation.headquarters.access, placed.building.access);
  assert(simulation.recruitCommander(placed.building.uid).ok);
  const settlement = simulation.saveState();
  const commander = settlement.military!.commander!;
  const soldier = settlement.military!.soldiers.find(row => row.commanderId === commander.id)!;
  commander.location = "recovering"; commander.recoverySeconds = 1800;
  soldier.combat!.hp = 1;
  settlement.actors.find(row => row.uid === soldier.actor)!.phase = "commanderRecovering";
  const game = await createGameSave(world, settlement, {
    animals: [], name: "Authenticated commander recovery", savedAt: Date.now(), source: "isolated acceptance fixture"
  });
  game.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[22]!, gems: 100 };
  await stageGameSession(game);
  return { actor: soldier.actor, commanderId: commander.id, game, lodge: placed.building.uid,
    mount: soldier.combat!.mount };
};
