import { banditSiteKey } from "../../render-common/buildings/bandit-camp-plan";
import { boatJettySites } from "./harbour-boat-reservations";
import type { RoadSegment } from "./road-types";
import type { MarkChangedTiles } from "./settlement-charting-grid-changes";
import { isOwnBuilding } from "./settlement-home";
import { landmassLabelAt } from "./settlement-landmass";
import { ownerOf } from "./settlement-ownership";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * HARBOUR-RECHECK: keyed copies of the settlement objects harbour site proofs read (buildings,
 * roads and bridges, road decorations, field sites, boat jetties). A key that appears, disappears or
 * changes marks the object's reach before and after the change. Reaches are conservative:
 * - a building's plot plus mill sails, door sweeps, signpost, entrance lane and navigation volumes;
 * - a road's reserved width and bridge abutments/mouths; a decoration's volumes and supports.
 */
const BUILDING_REACH = 8;
export const ROAD_REACH = 3;
const DECORATION_REACH = 1;
const JETTY_REACH = 1;

interface TileRect { maxX: number; maxZ: number; minX: number; minZ: number }
interface KeyedObject { key: string; rect: TileRect }
type KeyedObjects = Map<number | string, KeyedObject>;

export interface ChartingObjectSnapshot {
  buildings: KeyedObjects;
  decorations: KeyedObjects;
  fields: Map<string, number>;
  jetties: KeyedObjects;
  /** Landmass labels holding a current-player building: expedition sites there are never valid. */
  owned: string;
  roads: Map<string, number>;
  roadRects: Map<string, TileRect>;
}

export const pointsRect = (points: readonly SettlementPoint[], reach: number): TileRect => ({
  maxX: Math.floor(Math.max(...points.map(point => point.x)) + reach),
  maxZ: Math.floor(Math.max(...points.map(point => point.z)) + reach),
  minX: Math.floor(Math.min(...points.map(point => point.x)) - reach),
  minZ: Math.floor(Math.min(...points.map(point => point.z)) - reach)
});

const bridgePoints = (building: SettlementBuilding): SettlementPoint[] => {
  const site = building.bridgeSite;
  if (!site) return [];
  return [site.start, site.end, site.stockPoint, ...site.segments.flatMap(segment => [segment.start, segment.end])];
};

export const buildingRect = (building: SettlementBuilding) => pointsRect([
  { x: building.x - building.width / 2, z: building.z - building.depth / 2 },
  { x: building.x + building.width / 2, z: building.z + building.depth / 2 },
  building.access, ...bridgePoints(building)
], BUILDING_REACH);

/** Everything of a building that a proof can read: plot, model, stage, owner, level and bridge site. */
export const buildingKey = (building: SettlementBuilding) => [building.typeId, building.x, building.z,
  building.rotation, building.width, building.depth, building.access.x, building.access.z,
  building.construction, building.foundationProgress, ownerOf(building),
  building.workshopUpgrade?.level ?? 0, building.bandit ? banditSiteKey(building.bandit) : "", Boolean(building.eventCourtyard),
  building.bridgeSite ? JSON.stringify(building.bridgeSite) : ""].join(":");

export const roadKey = (segment: RoadSegment) => [segment.start.x, segment.start.z, segment.end.x, segment.end.z,
  segment.tier, segment.bridge ? JSON.stringify(segment.bridge) : ""].join(":");

const ownedLandmasses = (context: SettlementContext) => {
  const labels = new Set<number>();
  for (const building of context.buildings)
    if (isOwnBuilding(building)) labels.add(landmassLabelAt(context.options.world, building));
  return [...labels].sort((a, b) => a - b).join(",");
};

const keyedBuildings = (context: SettlementContext): KeyedObjects =>
  new Map(context.buildings.map(building => [building.uid,
    { key: buildingKey(building), rect: buildingRect(building) }]));

type DecorationFrame = ReturnType<NonNullable<SettlementContext["roadDecorations"]>["frames"]>[number];
const decorationBoxes = (frame: DecorationFrame) => [...frame.volumes, ...frame.supports];
/** The tiles a placed road decoration's volumes and supports reach. */
export const decorationRect = (frame: DecorationFrame) => {
  const corners = decorationBoxes(frame).flatMap(box =>
    [{ x: box.min[0], z: box.min[2] }, { x: box.max[0], z: box.max[2] }]);
  return pointsRect(corners.length ? corners : [{ x: frame.position[0], z: frame.position[2] }], DECORATION_REACH);
};
/** Everything of a road decoration that navigation reads: its volumes and supports. */
export const decorationKey = (frame: DecorationFrame) => JSON.stringify(decorationBoxes(frame));

const keyedDecorations = (context: SettlementContext): KeyedObjects =>
  new Map((context.roadDecorations?.frames() ?? []).map(frame =>
    [frame.uid, { key: decorationKey(frame), rect: decorationRect(frame) }]));

const keyedJetties = (context: SettlementContext): KeyedObjects =>
  new Map(boatJettySites(context).map((jetty, index) => [index, {
    key: JSON.stringify([jetty.foot, jetty.point, jetty.shoreRoute]),
    rect: pointsRect([jetty.foot, jetty.point, ...jetty.shoreRoute], JETTY_REACH)
  }]));

const countKeys = (keys: Iterable<string>) => {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
};

export const captureChartingObjects = (context: SettlementContext): ChartingObjectSnapshot => {
  const segments = context.options.roads.segments?.() ?? [];
  const roadRects = new Map(segments.map(segment => [roadKey(segment),
    pointsRect([segment.start, segment.end], ROAD_REACH)]));
  return { buildings: keyedBuildings(context), decorations: keyedDecorations(context),
    fields: countKeys((context.fieldCycles?.snapshot() ?? []).map(site => `${site.x}:${site.z}`)),
    jetties: keyedJetties(context), owned: ownedLandmasses(context),
    roads: countKeys(segments.map(roadKey)), roadRects };
};

const markRect = (rect: TileRect, mark: MarkChangedTiles) => mark(rect.minX, rect.minZ, rect.maxX, rect.maxZ);

const markKeyedChanges = (before: KeyedObjects, after: KeyedObjects, mark: MarkChangedTiles) => {
  for (const [id, previous] of before) {
    const current = after.get(id);
    if (current?.key === previous.key) continue;
    markRect(previous.rect, mark);
    if (current) markRect(current.rect, mark);
  }
  for (const [id, current] of after) if (!before.has(id)) markRect(current.rect, mark);
};

/** Calls `changed` for every key whose count differs. */
const forEachCountChange = (before: Map<string, number>, after: Map<string, number>,
  changed: (key: string) => void) => {
  for (const [key, count] of before) if (after.get(key) !== count) changed(key);
  for (const key of after.keys()) if (!before.has(key)) changed(key);
};

const markFieldCell = (key: string, mark: MarkChangedTiles) => {
  const [x, z] = key.split(":").map(Number);
  const tileX = Math.floor(x!), tileZ = Math.floor(z!);
  mark(tileX - 1, tileZ - 1, tileX + 1, tileZ + 1);
};

/**
 * Marks every object change between two snapshots; false when the current player's landmass
 * ownership changed (that renews every site of the affected island, not only near sites).
 */
export const chartingObjectChanges = (before: ChartingObjectSnapshot, after: ChartingObjectSnapshot,
  mark: MarkChangedTiles) => {
  if (before.owned !== after.owned) return false;
  markKeyedChanges(before.buildings, after.buildings, mark);
  markKeyedChanges(before.decorations, after.decorations, mark);
  markKeyedChanges(before.jetties, after.jetties, mark);
  forEachCountChange(before.roads, after.roads,
    key => markRect((before.roadRects.get(key) ?? after.roadRects.get(key))!, mark));
  forEachCountChange(before.fields, after.fields, key => markFieldCell(key, mark));
  return true;
};
