import { campaignGraphOrder } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type {
  Campaign, CampaignMap, CampaignMapNode
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  type PathArrow, type PathPoint, type PathSegment, segmentBetween, withArrowHead
} from "../../../campaign/path-arrows";
import {
  MAP_ARROW_MINIMUM, MAP_ARROW_SIZE, MAP_ENDING_OFFSET, MAP_PATH_NODE_GAP, MAP_VIEW_BOX,
  MAP_VIEW_FALLBACK_ASPECT, NODE_LAYOUT_LOWER_ROW, NODE_LAYOUT_MARGIN, NODE_LAYOUT_SLOTS, NODE_LAYOUT_UPPER_ROW,
  NODE_NUDGE_FAST_FACTOR, NODE_NUDGE_KEYS, NODE_NUDGE_STEP, NODE_POSITION_DECIMALS, PERCENT
} from "../constants";
import { displayText } from "../helpers";
import { graphOf } from "../paths/helpers";

const roundPosition = (value: number) => Number(value.toFixed(NODE_POSITION_DECIMALS));

/** A 0–1 fraction, rounded to the stored precision; NaN becomes 0. */
export const clampUnit = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return roundPosition(Math.min(Math.max(value, 0), 1));
};

/** Where the n-th map starts on the map view: left to right, zig-zagging between two rows. */
export const defaultNodePosition = (index: number): Pick<CampaignMapNode, "u" | "v"> => {
  const slot = index % NODE_LAYOUT_SLOTS;
  const u = NODE_LAYOUT_MARGIN + (1 - 2 * NODE_LAYOUT_MARGIN) * slot / (NODE_LAYOUT_SLOTS - 1);
  return { u: roundPosition(u), v: slot % 2 ? NODE_LAYOUT_UPPER_ROW : NODE_LAYOUT_LOWER_ROW };
};

const nodesOf = (campaign: Campaign) => campaign.mapNodes ?? [];

/** The campaign with a default node for `mapId` when it has none yet. */
export const addDefaultNode = (campaign: Campaign, mapId: string): Campaign => {
  const nodes = nodesOf(campaign);
  if (nodes.some(node => node.mapId === mapId)) return campaign;
  const index = Math.max(campaign.mapIds.indexOf(mapId), nodes.length);
  return { ...campaign, mapNodes: [...nodes, { mapId, ...defaultNodePosition(index) }] };
};

export const removeNode = (campaign: Campaign, mapId: string): Campaign =>
  ({ ...campaign, mapNodes: nodesOf(campaign).filter(node => node.mapId !== mapId) });

/** The campaign with `mapId` moved to u,v (clamped to the image); unknown maps get a node. */
export const setNodePosition = (campaign: Campaign, mapId: string, u: number, v: number): Campaign => {
  const node = { mapId, u: clampUnit(u), v: clampUnit(v) };
  const nodes = nodesOf(campaign);
  if (!nodes.some(entry => entry.mapId === mapId)) return { ...campaign, mapNodes: [...nodes, node] };
  return { ...campaign, mapNodes: nodes.map(entry => entry.mapId === mapId ? node : entry) };
};

/** u,v under a pointer inside the image's client rectangle (clamped to the image). */
export const pointerToNodePosition = (
  rect: Pick<DOMRect, "height" | "left" | "top" | "width">, clientX: number, clientY: number
) => ({
  u: clampUnit(rect.width > 0 ? (clientX - rect.left) / rect.width : 0),
  v: clampUnit(rect.height > 0 ? (clientY - rect.top) / rect.height : 0)
});

/** The node moved by an arrow key, or null for any other key. */
export const nudgeNodePosition = (node: Pick<CampaignMapNode, "u" | "v">, key: string, fast: boolean) => {
  const direction = NODE_NUDGE_KEYS[key];
  if (!direction) return null;
  const step = NODE_NUDGE_STEP * (fast ? NODE_NUDGE_FAST_FACTOR : 1);
  return { u: clampUnit(node.u + direction[0] * step), v: clampUnit(node.v + direction[1] * step) };
};

/** One drawn node: graph order number, name, CSS position and its stored u,v. */
export interface MapNodeView {
  id: string;
  label: string;
  left: string;
  name: string;
  selected: boolean;
  top: string;
  u: number;
  v: number;
}

/** One overlay segment (overlay box: height 100, width 100 × aspect). */
export type MapSegmentView = PathSegment;

/**
 * One dashed arrow between two maps joined by at least one edge: the shaft ends at the base of `head` (SVG polygon
 * points), whose tip stops at the target node's rim.
 */
export type MapPathView = PathArrow;

/** The end marker of a map with an exit that ends the campaign: a short stub from the node to a ring at x2,y2. */
export type MapEndingView = MapSegmentView;

/** One arrow per joined pair (several exits to one map share it) and one end marker per ending map. */
const graphOverlay = (
  campaign: Campaign, maps: readonly CampaignMap[], points: ReadonlyMap<string, PathPoint>
) => {
  const paths = new Map<string, MapPathView>(), endings = new Map<string, MapEndingView>();
  for (const { from, to } of graphOf(campaign, maps).edges) {
    const start = points.get(from);
    if (!start) continue;
    if (to === null) {
      const ring = { x: start.x + MAP_ENDING_OFFSET, y: start.y - MAP_ENDING_OFFSET };
      const stub = segmentBetween(`${from}>end`, start, ring, MAP_PATH_NODE_GAP, MAP_PATH_NODE_GAP);
      if (stub) endings.set(from, { ...stub, x2: ring.x, y2: ring.y });
      continue;
    }
    const target = points.get(to), id = `${from}>${to}`;
    const segment = target && !paths.has(id)
      ? segmentBetween(id, start, target, MAP_ARROW_MINIMUM, MAP_PATH_NODE_GAP)
      : null;
    if (segment) paths.set(id, withArrowHead(segment, MAP_ARROW_SIZE));
  }
  return { endings: [...endings.values()], paths: [...paths.values()] };
};

/**
 * Nodes in editor order (a listed map without a node gets its default position), numbered in graph order (a
 * topological order; plan §9), and the overlay: arrows along the campaign's edges (stored or derived linear ones)
 * and end markers. `aspect` (width / height) keeps the overlay undistorted, so arrowheads stay true.
 */
export const mapViewModel = (
  campaign: Campaign, maps: readonly CampaignMap[], selectedMapId: string | null, language: string, aspect = 1
) => {
  const placed = new Map(nodesOf(campaign).map(node => [node.mapId, node]));
  const names = new Map(maps.map(map => [map.id, map.name]));
  const order = campaignGraphOrder(graphOf(campaign, maps));
  const points = new Map<string, PathPoint>();
  const nodes: MapNodeView[] = campaign.mapIds.map((mapId, index) => {
    const { u, v } = placed.get(mapId) ?? defaultNodePosition(index);
    const name = names.get(mapId);
    points.set(mapId, { x: u * MAP_VIEW_BOX * aspect, y: v * MAP_VIEW_BOX });
    return {
      id: mapId, label: String(order.indexOf(mapId) + 1), left: `${u * PERCENT}%`,
      name: name ? displayText(name, language, mapId) : mapId,
      selected: mapId === selectedMapId, top: `${v * PERCENT}%`, u, v
    };
  });
  return { nodes, ...graphOverlay(campaign, maps, points) };
};

/** Width / height of the map view: the image's own, or the fallback while there is none. */
export const mapViewRatio = (image: { height: number; width: number } | null) =>
  (image && image.height > 0 ? image.width / image.height : MAP_VIEW_FALLBACK_ASPECT);

/** CSS aspect ratio of the map view: the image's own, or the fallback while there is none. */
export const mapViewAspect = (image: { height: number; width: number } | null) =>
  image ? `${image.width} / ${image.height}` : String(MAP_VIEW_FALLBACK_ASPECT);
