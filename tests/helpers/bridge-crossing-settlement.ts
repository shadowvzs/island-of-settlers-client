import { bridgeDecks, deckCoordinates } from "../../src/shared/settlement/bridge-deck";
import { BuildingType } from "../../src/shared/settlement/building-type-ids";
import { ROAD_GRID_STEP, type RoadPoint, type RoadSegment } from "../../src/shared/settlement/road-types";
import type { SettlementActor, SettlementPoint } from "../../src/shared/settlement/settlement-types";
import { ANGLED_RIVER, createAngledBridgeSettlement } from "./bridge-settlement";

export const CROSSING_BRIDGE_ID = 1;
/** The river ends this far downstream of the bridge, so both banks stay one landmass (one stock pool). */
const RIVER_END = 9;

type CrossingWorld = ReturnType<typeof createAngledBridgeSettlement>["world"];
type CrossingRoads = ReturnType<typeof createAngledBridgeSettlement>["roads"];

/** Half-cell road steps along one axis between two points sharing x or z. */
export const axisRoad = (from: RoadPoint, to: RoadPoint): RoadSegment[] => {
  const steps = Math.round((Math.abs(to.x - from.x) + Math.abs(to.z - from.z)) / ROAD_GRID_STEP);
  const dx = Math.sign(to.x - from.x) * ROAD_GRID_STEP, dz = Math.sign(to.z - from.z) * ROAD_GRID_STEP;
  return Array.from({ length: steps }, (_, index) => ({
    end: { x: from.x + dx * (index + 1), z: from.z + dz * (index + 1) },
    start: { x: from.x + dx * index, z: from.z + dz * index }, tier: "stone"
  }));
};

/** Adds road segments to the graph, skipping edges it already has. */
export const addRoadSegments = (roads: CrossingRoads, added: readonly RoadSegment[]) => {
  const key = (segment: RoadSegment) => [segment.start, segment.end].map(point => `${point.x}:${point.z}`)
    .sort().join("/");
  const present = new Set(roads.segments().map(key));
  return roads.replaceSegments([...roads.segments(), ...added.filter(segment => !present.has(key(segment)))]);
};

/**
 * The base fixture's home road leaves the headquarters' door straight through its own plot (that
 * network has no plot blocking); carriers stall there. Lead it round the hall instead.
 */
export const leadHomeRoadRound = (roads: CrossingRoads) => {
  const kept = roads.segments().filter(segment => segment.bridge || Math.max(segment.start.x, segment.end.x) > 8);
  const round = [...axisRoad({ x: 4, z: 19.5 }, { x: 4, z: 20.5 }), ...axisRoad({ x: 4, z: 20.5 }, { x: 8, z: 20.5 }),
    ...axisRoad({ x: 8, z: 20.5 }, { x: 8, z: 17 })];
  if (!roads.replaceSegments([...kept, ...round])) throw new Error("Home road refused");
};

/**
 * Dries the river beyond `RIVER_END` along its course: land joins round its end, so the far bank shares
 * the headquarters' stock pool (pools follow landmasses) while the only road across is the bridge.
 */
const endRiver = (world: CrossingWorld) => {
  const angle = ANGLED_RIVER.angleDegrees * Math.PI / 180;
  const along = (x: number, z: number) =>
    (x - ANGLED_RIVER.centre.x) * Math.cos(angle) + (z - ANGLED_RIVER.centre.z) * Math.sin(angle);
  const stride = world.cellsX + 1;
  for (let z = 0; z <= world.cellsZ; z += 1) for (let x = 0; x <= world.cellsX; x += 1)
    if (along(x, z) > RIVER_END) world.waterDepth[z * stride + x] = -1;
  for (let z = 0; z < world.cellsZ; z += 1) for (let x = 0; x < world.cellsX; x += 1) {
    if (along(x + 0.5, z + 0.5) <= RIVER_END) continue;
    world.blocking[z * world.cellsX + x] = 0;
    world.walkCost[z * world.cellsX + x] = 10;
  }
  world.terrainRevision = (world.terrainRevision ?? 0) + 1;
};

/**
 * The angled river settlement with a completed bridge (id 1, laid straight into the road graph; the
 * construction flow has its own tests) and a Woodcutter site on the east bank: its building
 * materials leave the headquarters on the west bank and cross the deck.
 */
export const createBridgeCrossingSettlement = (kind: "stone" | "wood" = "wood", stock?: Record<string, number>) => {
  const fixture = createAngledBridgeSettlement({ stock: { hammer: 4, logs: 40, planks: 40, stone: 40, ...stock } });
  const { eastEnd, pointer, roads, simulation, westAnchor, world } = fixture;
  endRiver(world);
  leadHomeRoadRound(roads);
  const plan = simulation.previewBridge(pointer, kind, westAnchor).plan;
  if (!plan) throw new Error("No crossing for the crossing settlement");
  const tiles: RoadSegment[] = plan.segments.map(segment =>
    ({ ...segment, bridge: { ...segment.bridge!, id: CROSSING_BRIDGE_ID } }));
  if (!roads.replaceSegments([...roads.segments(), ...tiles])) throw new Error("Bridge refused");
  world.buildRevision = (world.buildRevision ?? 0) + 1;
  const deck = bridgeDecks(tiles)[0]!;
  let site: ReturnType<typeof simulation.placeBuilding> | undefined;
  for (let x = 21; x < 29 && !site?.ok; x += 1) for (let z = 6; z < 26 && !site?.ok; z += 1) {
    const attempt = simulation.placeBuilding(BuildingType.Woodcutter, x, z);
    if (attempt.ok) site = attempt;
  }
  if (!site?.ok || !site.building) throw new Error("No east bank plot for the Woodcutter");
  const woodcutter = site.building;
  if (!simulation.connectRoads(woodcutter.access, eastEnd)) throw new Error("East building not connected");
  /** Restores the removed bridge exactly as it stood (a rebuilt crossing for resume checks). */
  const rebuild = () => {
    if (!roads.replaceSegments([...roads.segments(), ...tiles])) throw new Error("Bridge rebuild refused");
    world.buildRevision = (world.buildRevision ?? 0) + 1;
  };
  /** Along the deck from the west anchor (negative on the west shore road). */
  const along = (point: SettlementPoint) => deckCoordinates(deck, point).along;
  const westIsStart = deck.start.x < deck.end.x;
  const fromWest = (point: SettlementPoint) => westIsStart ? along(point) : deck.length - along(point);
  const loadedCarriers = () => simulation.frames().filter((actor: SettlementActor) =>
    actor.job === "Carrier" && actor.ware !== null && actor.delivery?.destination === woodcutter.uid);
  return { ...fixture, deck, fromWest, loadedCarriers, rebuild, tiles, woodcutter };
};
