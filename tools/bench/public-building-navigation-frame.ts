import { openLocalSaveStore } from "../../src/app/save-store/local-save-store";
import { settingsStorage } from "../../src/app/settings/graphics-settings";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { getBuildingNavigationProfile } from "../../src/render-common/buildings/building-navigation-profile";
import { createCommandLogRecorder } from "../../src/shared/settlement/command-log";
import { replayCommandLog } from "../../src/shared/settlement/command-log-replay";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { isPublicBuildingPointClear } from "../../src/shared/settlement/settlement-building-navigation";
import { findGroundPath, isGroundSegmentClear } from "../../src/shared/settlement/settlement-navigation";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementContext, SettlementPoint } from "../../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";

export const preparePublicBuildingFixture = async (placeType: number | null = 17) => {
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, seed: 1234, erosionDroplets: 100 });
  world.heights.fill(1); world.waterSurface.fill(0); world.waterDepth.fill(0);
  world.blocking.fill(0); world.walkCost.fill(10); world.props.count = 0;
  world.buildClass.fill(4); world.buildCap.fill(4); world.slopeClass.fill(0);
  world.start = { x: 24.5, z: 24.5 };
  const simulation = createSettlementSimulation({ clockStart: 0, initialSettlers: 0, initialStock: { planks: 20, stone: 20 },
    resourceTargets: () => [], roads: createRoadNetwork(world), world });
  if (placeType !== null) {
    const [width, depth] = getBuildingDefinition(placeType).gridFootprint;
    const placed = simulation.placeBuilding(placeType, 48 + width % 2 / 2, 48 + depth % 2 / 2);
    if (!placed.ok) throw new Error(`Native yard fixture: ${placed.reason}`);
    Object.assign(placed.building!, { construction: 1, foundationProgress: 1, required: {} });
  }
  settingsStorage.writeFog(false);
  const saved = await createGameSave(world, simulation.saveState(), { animals: [], name: "Public exterior navigation",
    savedAt: Date.now(), source: "generated" });
  await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(saved));
  return placeType === null ? -1 : simulation.buildings().at(-1)!.uid;
};

/** Places a real building after the empty yard save has loaded, triggering the live grass hook. */
export const placeYardBuilding = (typeId: number) => {
  const pilot = (window as any).__yardReview, simulation = pilot.simulation;
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const placed = simulation.placeBuilding(typeId, 48 + width % 2 / 2, 48 + depth % 2 / 2);
  if (!placed.ok) throw new Error(`Live yard placement: ${placed.reason}`);
  Object.assign(placed.building!, { construction: 1, foundationProgress: 1, required: {} });
  pilot.settlement.update(0);
  return { uid: placed.building!.uid, x: placed.building!.x, z: placed.building!.z };
};

export const beginPublicBuildingJourney = () => {
  const pilot = (window as any).__yardReview, simulation = pilot.simulation, world = pilot.world;
  const advance = simulation.update.bind(simulation);
  simulation.update = () => {};
  const building = simulation.buildings().find((entry: any) => entry.typeId === 17)!;
  const context = { options: { world }, buildings: simulation.buildings(), occupied: new Uint8Array(world.cellsX * world.cellsZ),
    playerNation: "roman" } as SettlementContext;
  for (const entry of context.buildings)
    for (let z = entry.z - entry.depth / 2; z < entry.z + entry.depth / 2; z++)
      for (let x = entry.x - entry.width / 2; x < entry.x + entry.width / 2; x++)
        context.occupied[z * world.cellsX + x] = 1;
  const points: SettlementPoint[] = [];
  for (let z = building.z - building.depth / 2 + .25; z < building.z + building.depth / 2; z += .25)
    for (let x = building.x - building.width / 2 + .25; x < building.x + building.width / 2; x += .25)
      if (isPublicBuildingPointClear(context, { x, z })) points.push({ x, z });
  const from = points[0]!;
  const to = points.find(point => Math.hypot(point.x - from.x, point.z - from.z) > 2 &&
    !isGroundSegmentClear(context, from, point) && findGroundPath(context, from, point));
  if (!to) throw new Error("No connected exterior route around this actual room");
  const base = structuredClone(simulation.saveState()), recorder = createCommandLogRecorder(simulation,
    { sourceVersion: "public-building-native" });
  recorder.open();
  const spawn = simulation.spawnDebugSoldier(from, { rank: 1, type: "shield" });
  if (!spawn || !simulation.commandMilitary([spawn.id], to, "move")) throw new Error("Regular soldier refused clear exterior");
  Object.assign(pilot.camera, { centerX: building.x, centerZ: building.z, tilt: 0, yaw: .5, zoom: 2.9 });
  const hash = () => [world.heights, world.walkCost, context.occupied].map(array => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    let value = 2166136261;
    for (const byte of bytes) value = Math.imul(value ^ byte, 16777619);
    return value >>> 0;
  });
  pilot.journey = { advance, base, building, context, from, hash, initialHash: hash(), previous: from,
    recorder, spawn, ticks: 0, to, travelled: 0, points: [] };
  return { from, to, building: { type: building.typeId, x: building.x, z: building.z,
    width: building.width, depth: building.depth }, path: simulation.frames().find((actor: any) => actor.uid === spawn.id)?.path,
    privateRooms: getBuildingNavigationProfile(17, "roman").interiors };
};

export const stepPublicBuildingJourney = (maximum: number) => {
  const pilot = (window as any).__yardReview, simulation = pilot.simulation, journey = pilot.journey;
  let arrived = false;
  for (let tick = 0; tick < maximum && !arrived; tick++) {
    journey.advance(.05); journey.ticks++;
    const actor = simulation.frames().find((entry: any) => entry.uid === journey.spawn.id)!;
    if (!isPublicBuildingPointClear(journey.context, actor)) throw new Error(`Physical room/stock cut at tick ${journey.ticks}`);
    journey.travelled += Math.hypot(actor.x - journey.previous.x, actor.z - journey.previous.z);
    journey.previous = { x: actor.x, z: actor.z }; journey.points.push(journey.previous);
    arrived = Math.hypot(actor.x - journey.to.x, actor.z - journey.to.z) < .3;
  }
  pilot.settlement.update(0);
  return { arrived, ticks: journey.ticks, travelled: journey.travelled, position: journey.previous,
    actorFrame: pilot.settlement.workerFrames.find((frame: any) => frame.actorId === journey.spawn.id) };
};

export const finishPublicBuildingJourney = () => {
  const pilot = (window as any).__yardReview, journey = pilot.journey;
  const interval = journey.recorder.close("home"), world = structuredClone(pilot.world);
  const replay = createSettlementSimulation({ clockStart: 0, initialSettlers: 0, initialStock: {},
    resourceTargets: () => [], roads: createRoadNetwork(world), world });
  const loaded = replay.loadState(journey.base);
  if (!loaded.ok) throw new Error("Replay base refused");
  const result = replayCommandLog(replay, interval, { rejectDebug: false });
  const report = { replay: result, commands: interval.entries.map((entry: any) => entry.command.name),
    worldHashesBefore: journey.initialHash, worldHashesAfter: journey.hash(), ticks: journey.ticks,
    travelled: journey.travelled, directDistance: Math.hypot(journey.to.x - journey.from.x, journey.to.z - journey.from.z),
    samples: journey.points.length, reservedAtArrival: pilot.simulation.isOccupied(journey.to.x, journey.to.z) };
  journey.recorder.dispose();
  return report;
};
