import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import {
  ROAD_GRID_STEP,
  type RoadPoint,
  type RoadSegment,
  type RoadTier
} from "../../src/shared/settlement/road-types";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import {
  BLOCKING,
  BUILD,
  MATERIAL_COUNT,
  PROP,
  type WorldData
} from "../../src/shared/world/world-data";
import { type AngledRiver, paintAngledRiver } from "./bridge-world";

const SIZE = 32;
const RIVER_FROM = 10;
const RIVER_TO = 11;
const RIVER_Z = 16;

const lineRoads = (start: RoadPoint, end: RoadPoint, tier: RoadTier): RoadSegment[] => {
  const roads: RoadSegment[] = [];
  for (let x = start.x; x < end.x; x += ROAD_GRID_STEP)
    roads.push({ end: { x: x + ROAD_GRID_STEP, z: start.z }, start: { x, z: start.z }, tier });
  return roads;
};

/** Flat island with a straight north-south river and a headquarters beside the west bank. */
const bridgeSettlementWorld = (river?: AngledRiver): WorldData => {
  const stride = SIZE + 1;
  const riverDistance = new Float32Array(stride * stride).fill(100);
  const waterDepth = new Float32Array(stride * stride);
  for (let z = 0; z <= SIZE; z += 1)
    for (let x = 0; x <= SIZE; x += 1) {
      const vertex = z * stride + x;
      if (x >= RIVER_FROM && x <= RIVER_TO) {
        waterDepth[vertex] = 1;
        riverDistance[vertex] = 0;
      } else {
        riverDistance[vertex] = x < RIVER_FROM ? RIVER_FROM - x : x - RIVER_TO;
      }
    }
  const blocking = new Uint8Array(SIZE * SIZE);
  const walkCost = new Uint8Array(SIZE * SIZE).fill(10);
  if (river) paintAngledRiver({ blocking, cellsX: SIZE, cellsZ: SIZE, riverDistance, walkCost, waterDepth }, river);
  else for (let z = 0; z < SIZE; z += 1)
    for (let x = RIVER_FROM; x <= RIVER_TO; x += 1)
      blocking[z * SIZE + x] = BLOCKING.water;
  return {
    cellsX: SIZE,
    cellsZ: SIZE,
    seaLevel: 0,
    seed: 91,
    start: { x: 4.5, z: 16.5 },
    heights: new Float32Array(stride * stride),
    waterDepth,
    waterSurface: new Float32Array(stride * stride).fill(0.2),
    riverDistance,
    blocking,
    walkCost,
    buildClass: new Uint8Array(SIZE * SIZE).fill(BUILD.large),
    buildCap: new Uint8Array(SIZE * SIZE).fill(BUILD.large),
    // Deliberately absent: this fixture keeps its authored water blocking instead of letting
    // foundation refreshes reclassify the straight test river from vertex depth.
    slopeClass: undefined,
    splat: new Uint8Array(stride * stride * MATERIAL_COUNT),
    heightLevels: new Uint8Array(stride * stride),
    oreAmount: new Uint8Array(SIZE * SIZE),
    mineZone: new Uint16Array(SIZE * SIZE),
    mineZones: [],
    props: {
      count: 0,
      types: new Uint8Array([PROP.fern, 0, 0, 0]),
      x: new Float32Array(4),
      z: new Float32Array(4)
    },
    waterfalls: []
  } as unknown as WorldData;
};

export const createBridgeSettlement = (
  options: { rightRoad?: boolean; stock?: Record<string, number> } = {}
) => {
  const { rightRoad = true, stock = { hammer: 2, logs: 24, planks: 24, stone: 24 } } = options;
  const world = bridgeSettlementWorld();
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({
    initialSettlers: 12,
    initialStock: { ...stock },
    roads,
    world
  });
  const leftAnchor = { x: 9, z: RIVER_Z };
  const rightAnchor = { x: RIVER_TO + 1, z: RIVER_Z };
  const pointer = { x: RIVER_FROM + 0.5, z: RIVER_Z };
  const home = simulation.headquarters;
  if (!simulation.connectRoads(home.access, leftAnchor))
    throw new Error("Bridge fixture could not connect the west shore road");
  if (rightRoad) {
    const seeded = [...roads.segments(), ...lineRoads(rightAnchor, { x: 18, z: RIVER_Z }, "stone")];
    if (!roads.replaceSegments(seeded)) throw new Error("Bridge fixture could not seed the east shore road");
  }
  const advance = (seconds: number, step = 0.1) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += step) simulation!.update(step);
  };
  return { advance, leftAnchor, pointer, rightAnchor, roads, simulation, world };
};

/** Steep diagonal river at 60 degrees; its water cells are unwalkable, so only the deck carries people. */
export const ANGLED_RIVER: AngledRiver = { angleDegrees: 60, centre: { x: 17, z: 16 }, halfWidth: 1.4 };

/**
 * The same island crossed by an angled river: the planner chooses the anchors, the fixture builds
 * the west shore road from the headquarters and seeds a stone road east of the far anchor.
 */
export const createAngledBridgeSettlement = (
  options: { eastRoad?: boolean; stock?: Record<string, number> } = {}
) => {
  const { eastRoad = true, stock = { hammer: 2, logs: 24, planks: 24, stone: 24 } } = options;
  const world = bridgeSettlementWorld(ANGLED_RIVER);
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({
    initialSettlers: 12,
    initialStock: { ...stock },
    roads,
    world
  });
  const pointer = { ...ANGLED_RIVER.centre };
  // The live preview names both anchors before any shore road exists (its rules are the command's).
  const planned = simulation.previewBridge(pointer, "wood").plan;
  if (!planned) throw new Error("Angled bridge fixture has no crossing");
  const [westAnchor, eastAnchor] = [planned.start, planned.end].sort((a, b) => a.x - b.x) as
    [RoadPoint, RoadPoint];
  if (!simulation.connectRoads(simulation.headquarters.access, westAnchor))
    throw new Error("Angled bridge fixture could not connect the west shore road");
  const eastEnd = { x: eastAnchor.x + 5, z: eastAnchor.z };
  if (eastRoad && !roads.replaceSegments([...roads.segments(), ...lineRoads(eastAnchor, eastEnd, "stone")]))
    throw new Error("Angled bridge fixture could not seed the east shore road");
  const advance = (seconds: number, step = 0.1) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += step) simulation.update(step);
  };
  return { advance, eastAnchor, eastEnd, pointer, roads, simulation, westAnchor, world };
};
