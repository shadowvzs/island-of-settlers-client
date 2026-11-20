import { DMath } from "../math/deterministic-math";
import { sampleBilinear } from "../world/grid-geometry";
import { BRIDGE_DECK_HALF_WIDTH, type BridgeDeck, bridgeDecks, deckCoordinates, decksOverlap } from "./bridge-deck";
import type { BridgePlan } from "./bridge-planning";
import { type BridgeWaterWorld, isBridgeWater } from "./bridge-river-banks";
import type { RoadPoint } from "./road-types";

/**
 * Bridge placement overlay data: valid river crossings shown while the Road-tab bridge tool is
 * active, the bridge counterpart of the building fit spots. Every spot comes from the authoritative
 * bridge preview (planner + bank rule + command checks), so the overlay can never show a crossing
 * the build command would refuse for geometric reasons.
 */
export type BridgeSpotStatus = "needs-road" | "ready";

export interface BridgeSpot {
  deck: BridgeDeck;
  plan: BridgePlan;
  /** River point whose plan produced this crossing; building from it reproduces the same span. */
  pointer: RoadPoint;
  status: BridgeSpotStatus;
}

/** Preview fields the overlay reads (`BridgePreview` from the construction runtime). */
export interface BridgeSpotPreview {
  ok: boolean;
  plan?: BridgePlan;
  reason?: string;
}

/** Valid crossings whose only missing piece is the player's road or storage network. */
const NEEDS_ROAD_REASONS = new Set(["no-storage", "shore-road-missing", "shore-stock-unreachable"]);
/** Matches the sea/river split of the bridge planner. */
const SEA_RIVER_DISTANCE = 2.5;
/** A pointer this far outside a spot's deck (across or beyond an anchor) still snaps to it. */
export const BRIDGE_SPOT_SNAP_REACH = 1.2;

export const bridgeSpotStatus = (preview: BridgeSpotPreview): BridgeSpotStatus | null => {
  if (!preview.plan) return null;
  if (preview.ok) return "ready";
  return NEEDS_ROAD_REASONS.has(preview.reason ?? "") ? "needs-road" : null;
};

/** Cell centre and corner: together they reach crossings on whole and half grid lines of both axes. */
const CELL_POINTERS = [[0.5, 0.5], [0, 0]] as const;

/**
 * Planning pointers over the owned river (two per cell), nearest `focus` first. Open sea and cells
 * outside the territory never become pointers.
 */
export const bridgeSpotPointers = (
  world: BridgeWaterWorld & { riverDistance?: Float32Array },
  owned: Uint8Array | undefined,
  focus: RoadPoint
): RoadPoint[] => {
  const pointers: RoadPoint[] = [];
  for (let cellZ = 0; cellZ < world.cellsZ; cellZ += 1)
    for (let cellX = 0; cellX < world.cellsX; cellX += 1) {
      if (owned && owned[cellZ * world.cellsX + cellX] !== 1) continue;
      for (const [offsetX, offsetZ] of CELL_POINTERS) {
        const pointer = { x: cellX + offsetX, z: cellZ + offsetZ };
        if (!isBridgeWater(world, pointer)) continue;
        if (world.riverDistance &&
          sampleBilinear(world, world.riverDistance, pointer.x, pointer.z) > SEA_RIVER_DISTANCE) continue;
        pointers.push(pointer);
      }
    }
  const distance = (point: RoadPoint) => (point.x - focus.x) ** 2 + (point.z - focus.z) ** 2;
  return pointers.sort((a, b) => distance(a) - distance(b) || a.z - b.z || a.x - b.x);
};

/** Shown first when outlines would overlap: a crossing the player can build now wins. */
const STATUS_ORDER: Readonly<Record<BridgeSpotStatus, number>> = { "needs-road": 1, ready: 0 };

/**
 * Collects previews into unique crossings and shows a non-overlapping set of them: buildable
 * crossings first, then the rest in scan order, so the overlay never stacks outlines.
 */
export const createBridgeSpotCollector = () => {
  const found: BridgeSpot[] = [];
  const keys = new Set<string>();
  let shown: BridgeSpot[] | null = null;
  const add = (pointer: RoadPoint, preview: BridgeSpotPreview) => {
    const status = bridgeSpotStatus(preview);
    const plan = preview.plan;
    if (!status || !plan) return;
    const ends = [plan.start, plan.end].map(point => `${point.x}:${point.z}`).sort().join("/");
    const deck = bridgeDecks(plan.segments)[0];
    if (keys.has(ends) || !deck) return;
    keys.add(ends);
    found.push({ deck, plan, pointer: { ...pointer }, status });
    shown = null;
  };
  const spots = (): readonly BridgeSpot[] => {
    if (shown) return shown;
    const ordered = found.map((spot, order) => ({ order, spot }))
      .sort((a, b) => STATUS_ORDER[a.spot.status] - STATUS_ORDER[b.spot.status] || a.order - b.order);
    const selected: BridgeSpot[] = [];
    for (const { spot } of ordered)
      if (!selected.some(other => decksOverlap(other.deck, spot.deck))) selected.push(spot);
    shown = selected;
    return selected;
  };
  return { add, spots };
};

/** Distance from a point to the deck rectangle (0 inside it). */
const deckGap = (deck: BridgeDeck, point: RoadPoint) => {
  const { across, along } = deckCoordinates(deck, point);
  const beyond = Math.max(0, -along, along - deck.length);
  const aside = Math.max(0, Math.abs(across) - BRIDGE_DECK_HALF_WIDTH);
  return DMath.hypot(beyond, aside);
};

/** The shown crossing under or beside the pointer (the hover snaps to it), or null. */
export const nearestBridgeSpot = (
  spots: readonly BridgeSpot[], point: RoadPoint, reach = BRIDGE_SPOT_SNAP_REACH
): BridgeSpot | null => {
  let best: BridgeSpot | null = null, bestGap = reach;
  for (const spot of spots) {
    const gap = deckGap(spot.deck, point);
    if (gap <= bestGap) { best = spot; bestGap = gap; }
  }
  return best;
};
