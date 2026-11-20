import { isOnCompletedBridgeDeck } from "../../src/shared/settlement/bridge-deck-navigation";
import { isOnBridgeMasonry } from "../../src/shared/settlement/bridge-masonry";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { ROAD_GRID_STEP, type RoadPoint, type RoadSegment } from "../../src/shared/settlement/road-types";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementContext, SettlementPoint } from "../../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";
import { type AngledRiver, paintAngledRiver } from "./bridge-world";

export const RIVER_SCENE_SIZE = 48;

/** A flat island cut from edge to edge by one river: the only way across is the bridge. */
const riverWorld = (river: AngledRiver) => {
  const size = RIVER_SCENE_SIZE;
  const world = { seed: 31, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 6.5, z: 6.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    riverDistance: new Float32Array((size + 1) ** 2), waterDepth: new Float32Array((size + 1) ** 2),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  paintAngledRiver(world as unknown as Parameters<typeof paintAngledRiver>[0], river);
  return world;
};

/** Straight shore road of half-cell edges from an anchor, along the axis that leaves the river. */
const shoreRoad = (anchor: RoadPoint, other: RoadPoint): RoadSegment[] => {
  const dx = anchor.x - other.x, dz = anchor.z - other.z;
  const step = Math.abs(dx) >= Math.abs(dz)
    ? { x: Math.sign(dx) * ROAD_GRID_STEP, z: 0 } : { x: 0, z: Math.sign(dz) * ROAD_GRID_STEP };
  return Array.from({ length: 10 }, (_, index) => ({
    end: { x: anchor.x + step.x * (index + 1), z: anchor.z + step.z * (index + 1) },
    start: { x: anchor.x + step.x * index, z: anchor.z + step.z * index }, tier: "stone"
  }));
};

export const BRIDGE_SCENE_RIVERS: readonly [string, AngledRiver][] = [
  ["straight", { angleDegrees: 90, centre: { x: 24, z: 24 }, halfWidth: 1.6 }],
  ["angled", { angleDegrees: 60, centre: { x: 24, z: 24 }, halfWidth: 1.5 }]
];

type SimulationOptions = Omit<Parameters<typeof createSettlementSimulation>[0], "roads" | "world">;

/**
 * The river island with one completed bridge (planned by the live preview) and stone shore roads on
 * both banks; `west`/`east` are its anchors by x.
 */
export const bridgeRiverScene = (
  river: AngledRiver, kind: "stone" | "wood", options: Partial<SimulationOptions> = {},
  shape?: (world: WorldData) => void
) => {
  const world = riverWorld(river);
  shape?.(world);
  let simulation!: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 4,
    withoutMilitaryCommander: true, ...options, roads, world });
  const plan = simulation.previewBridge(river.centre, kind).plan;
  if (!plan) throw new Error("No crossing for the river");
  const segments = [...roads.segments(), ...plan.segments, ...shoreRoad(plan.start, plan.end),
    ...shoreRoad(plan.end, plan.start)];
  if (!roads.replaceSegments(segments)) throw new Error("Bridge roads refused");
  world.buildRevision = (world.buildRevision ?? 0) + 1;
  const [west, east] = [plan.start, plan.end].sort((a, b) => a.x - b.x) as [RoadPoint, RoadPoint];
  // The navigation predicates read the same roads and world the actors use.
  const probe = { buildings: [], options: { roads, world } } as unknown as SettlementContext;
  /** Problem with a body at this point: in the river beside the deck, or on the bridge masonry. */
  const placeProblem = (point: SettlementPoint) => {
    const cell = Math.floor(point.z) * RIVER_SCENE_SIZE + Math.floor(point.x);
    if (world.walkCost[cell] === 0 && !isOnCompletedBridgeDeck(probe, point)) return "in the river";
    return isOnBridgeMasonry(probe, point) ? "on the masonry" : null;
  };
  const onDeck = (point: SettlementPoint) => isOnCompletedBridgeDeck(probe, point);
  return { east, onDeck, placeProblem, plan, roads, simulation, west, world };
};
