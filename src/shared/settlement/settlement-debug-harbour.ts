import { DMath } from "../math/deterministic-math";
import { HARBOUR_TYPE_ID } from "./building-type-ids";
import { legalDraft, raiseFinishedBuilding } from "./settlement-debug-raise";
import { demolishSettlementBuilding } from "./settlement-demolition";
import { findHomeBuilding, isOwnBuilding } from "./settlement-home";
import { createSeaMask } from "./settlement-sea-navigation";
import { settlementTerritory } from "./settlement-territory";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** Plot corners this many cells (4-neighbour steps) from open sea; the harbour rule needs 8 from its door. */
const SHORE_DISTANCE = 12;
/** Full placement checks (each with a shore route search) before giving up. */
const MAX_PLACEMENT_CHECKS = 600;
/** Placed harbours whose road to the headquarters is tried before giving up. */
const MAX_ROAD_ATTEMPTS = 6;
const UNREACHED = 255;
const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

/** Truthy when the road was added. */
type ConnectRoads = (start: SettlementPoint, end: SettlementPoint) => unknown;
export type DebugHarbourResult =
  | { ok: true; harbour: SettlementBuilding; placed: boolean }
  | { ok: false; reason: string };

/** Steps from every cell to the nearest open sea cell, capped at `limit` (beyond it: UNREACHED). */
const seaStepDistances = (cellsX: number, cellsZ: number, sea: Uint8Array, limit: number) => {
  const distances = new Uint8Array(cellsX * cellsZ).fill(UNREACHED), queue: number[] = [];
  for (let cell = 0; cell < sea.length; cell++) if (sea[cell]) { distances[cell] = 0; queue.push(cell); }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % cellsX, z = (cell - x) / cellsX, next = distances[cell]! + 1;
    if (next > limit) continue;
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz, neighbour = nz * cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= cellsX || nz >= cellsZ || distances[neighbour] !== UNREACHED) continue;
      distances[neighbour] = next;
      queue.push(neighbour);
    }
  }
  return distances;
};

/** Owned land cells near the sea, nearest to the headquarters first (harbour plot corners). */
export const shoreCells = (context: SettlementContext, home: SettlementBuilding) => {
  const { world } = context.options;
  const { owned } = settlementTerritory(context);
  const sea = createSeaMask(world);
  const distances = seaStepDistances(world.cellsX, world.cellsZ, sea, SHORE_DISTANCE);
  const cells: Array<{ x: number; z: number; distance: number }> = [];
  for (let cell = 0; cell < owned.length; cell++) {
    if (owned[cell] !== 1 || sea[cell] || distances[cell] === UNREACHED) continue;
    const x = cell % world.cellsX, z = (cell - x) / world.cellsX;
    cells.push({ distance: DMath.hypot(x - home.x, z - home.z), x, z });
  }
  return cells.sort((a, b) => a.distance - b.distance);
};

/** Completed player harbour that the headquarters reaches by road. */
const connectedHarbour = (context: SettlementContext, home: SettlementBuilding) =>
  context.buildings.find(building => building.typeId === HARBOUR_TYPE_ID && building.construction === 1 &&
    isOwnBuilding(building) && context.options.roads.route(home.access, building.access));

/** The nearest legal owned shore plot whose harbour the headquarters reaches by a new dirt road. */
const placeConnectedHarbour = (context: SettlementContext, home: SettlementBuilding, connectRoads: ConnectRoads) => {
  let checks = 0, roadAttempts = 0;
  for (const cell of shoreCells(context, home)) for (let rotation = 0; rotation < 4; rotation++) {
    if (++checks > MAX_PLACEMENT_CHECKS || roadAttempts >= MAX_ROAD_ATTEMPTS) return null;
    const draft = legalDraft(context, HARBOUR_TYPE_ID, cell.x, cell.z, rotation);
    if (!draft) continue;
    const harbour = raiseFinishedBuilding(context, draft, "Harbour");
    if (connectRoads(home.access, harbour.access)) return harbour;
    demolishSettlementBuilding(context, harbour.uid);
    roadAttempts++;
  }
  return null;
};

/**
 * Development menu: the first finished harbour on the headquarters' road network, or a new one
 * raised instantly on the nearest legal owned shore and joined to the headquarters by a dirt road.
 */
export const ensureDebugHarbour = (context: SettlementContext, connectRoads: ConnectRoads): DebugHarbourResult => {
  const home = findHomeBuilding(context);
  if (!home) return { ok: false, reason: "The island has no headquarters" };
  const existing = connectedHarbour(context, home);
  if (existing) return { harbour: existing, ok: true, placed: false };
  const harbour = placeConnectedHarbour(context, home, connectRoads);
  if (harbour) return { harbour, ok: true, placed: true };
  return { ok: false,
    reason: "No harbour plot on your coast can be reached by road: expand your territory to the sea" };
};
