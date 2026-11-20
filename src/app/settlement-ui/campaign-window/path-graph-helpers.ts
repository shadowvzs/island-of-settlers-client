import type { I18n } from "@lingui/core";

import type {
  CampaignEdgeState, CampaignEdgeView, CampaignNodeState
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import { translateMessage } from "../../../shared/i18n/translate";
import {
  type PathArrow, type PathPoint, type PathSegment, segmentBetween, withArrowHead
} from "../../campaign/path-arrows";
import { joinClassNames } from "../../components/helpers";
import { campaignRecordName } from "../../settlement/campaign-record-names";
import {
  PATH_ARROW_MINIMUM, PATH_ARROW_SIZE, PATH_COLUMN_WIDTH, PATH_EDGE_CLASS, PATH_EDGE_STATE_RANK,
  PATH_ENDING_OFFSET_X, PATH_ENDING_OFFSET_Y, PATH_NODE_CENTER_Y, PATH_NODE_CLASS, PATH_NODE_GAP, PATH_ROW_HEIGHT
} from "./constants";
import { CAMPAIGN_WINDOW_MESSAGES as M } from "./messages";
import type { CampaignChoice, CampaignMapChoice } from "./types";

/** One map of the compact path graph: its graph-order number, name and pixel position (circle centre). */
export interface PathGraphNode {
  className: string;
  id: string;
  label: string;
  left: number;
  name: string;
  node: CampaignNodeState;
  selected: boolean;
  /** Tooltip and accessible name: number, name and state. */
  title: string;
  top: number;
}
export interface PathGraphEdge extends PathArrow {
  className: string;
}
export interface PathGraphEnding extends PathSegment {
  className: string;
}
export interface PathGraphModel {
  edges: PathGraphEdge[];
  endings: PathGraphEnding[];
  height: number;
  nodes: PathGraphNode[];
  viewBox: string;
  width: number;
}

/**
 * Graph layer of every offered map: a start is 0, a target one more than its deepest source. The maps come in
 * graph order (topological), so the forward edges sorted by their source settle every layer in one pass; an edge
 * back to an earlier map (a cycle) and an edge to a map that is not offered are ignored.
 */
const layersOf = (maps: readonly CampaignMapChoice[], edges: readonly CampaignEdgeView[]) => {
  const index = new Map(maps.map((entry, position) => [entry.map.id, position]));
  const layers = new Map(maps.map(entry => [entry.map.id, 0]));
  const forward = edges.flatMap(({ edge: { from, to } }) => {
    const source = index.get(from), target = to === null ? undefined : index.get(to);
    if (source === undefined || target === undefined || target <= source) return [];
    return [{ from, source, to: to! }];
  }).sort((left, right) => left.source - right.source);
  for (const { from, to } of forward) layers.set(to, Math.max(layers.get(to)!, layers.get(from)! + 1));
  return layers;
};

/** Circle centres: columns by layer, rows in graph order, each column centred vertically. */
const positionsOf = (maps: readonly CampaignMapChoice[], layers: ReadonlyMap<string, number>) => {
  const columns = new Map<number, string[]>();
  for (const { map } of maps) {
    const layer = layers.get(map.id)!;
    columns.set(layer, [...columns.get(layer) ?? [], map.id]);
  }
  const rows = Math.max(1, ...[...columns.values()].map(column => column.length));
  const points = new Map<string, PathPoint>();
  for (const [layer, column] of columns) {
    const offset = (rows - column.length) * PATH_ROW_HEIGHT / 2;
    column.forEach((mapId, row) => points.set(mapId, {
      x: (layer + 1 / 2) * PATH_COLUMN_WIDTH, y: offset + row * PATH_ROW_HEIGHT + PATH_NODE_CENTER_Y
    }));
  }
  return { columns: Math.max(1, columns.size), points, rows };
};

interface DrawnPair {
  from: string;
  state: CampaignEdgeState;
  to: string | null;
}

/** One drawn pair per `from → to` (or `from → end`), with the strongest state of its edges. */
const drawnPairs = (edges: readonly CampaignEdgeView[]) => {
  const pairs = new Map<string, DrawnPair>();
  for (const { edge: { from, to }, state } of edges) {
    const id = `${from}>${to ?? ""}`, known = pairs.get(id);
    if (!known || PATH_EDGE_STATE_RANK[state] > PATH_EDGE_STATE_RANK[known.state]) pairs.set(id, { from, state, to });
  }
  return pairs;
};

const edgeClass = (state: CampaignEdgeState) => `${PATH_EDGE_CLASS} ${PATH_EDGE_CLASS}--${state}`;

const endingOf = (id: string, start: PathPoint, state: CampaignEdgeState): PathGraphEnding | null => {
  const ring = { x: start.x + PATH_ENDING_OFFSET_X, y: start.y + PATH_ENDING_OFFSET_Y };
  const stub = segmentBetween(id, start, ring, PATH_NODE_GAP, PATH_NODE_GAP);
  return stub && { ...stub, className: edgeClass(state), x2: ring.x, y2: ring.y };
};

const arrowOf = (id: string, start: PathPoint, target: PathPoint, state: CampaignEdgeState) => {
  const segment = segmentBetween(id, start, target, PATH_ARROW_MINIMUM, PATH_NODE_GAP);
  return segment && { ...withArrowHead(segment, PATH_ARROW_SIZE), className: edgeClass(state) };
};

/** One arrow per joined pair of offered maps and one end ring per ending map, styled by state. */
const overlayOf = (edges: readonly CampaignEdgeView[], points: ReadonlyMap<string, PathPoint>) => {
  const arrows: PathGraphEdge[] = [], endings: PathGraphEnding[] = [];
  for (const [id, { from, state, to }] of drawnPairs(edges)) {
    const start = points.get(from);
    if (!start) continue;
    if (to === null) {
      const ending = endingOf(id, start, state);
      if (ending) endings.push(ending);
      continue;
    }
    const target = points.get(to), arrow = target && arrowOf(id, start, target, state);
    if (arrow) arrows.push(arrow);
  }
  return { arrows, endings };
};

const nodeOf = (
  { map, node }: CampaignMapChoice, order: number, point: PathPoint, selectedId: string | undefined, i18n?: I18n
): PathGraphNode => {
  const name = campaignRecordName(map, i18n), selected = map.id === selectedId;
  return {
    className: joinClassNames(
      PATH_NODE_CLASS, `${PATH_NODE_CLASS}--${node}`, selected && `${PATH_NODE_CLASS}--selected`
    ),
    id: map.id, label: String(order), left: point.x, name, node, selected,
    title: translateMessage(i18n, M.pathNode, { name, order, status: translateMessage(i18n, M.status[node]) }),
    top: point.y
  };
};

/**
 * The compact path graph of the player window (BR4, plan §8 C13 preview): maps numbered in graph order like the
 * list, columns by graph layer, taken paths gold, open ones dashed, closed ones faint. Names stay shown for every
 * map (owner Q3: unreached and closed maps dimmed, not hidden).
 */
export const pathGraphModel = (
  choice: CampaignChoice | undefined, selectedId: string | undefined, i18n?: I18n
): PathGraphModel => {
  const maps = choice?.maps ?? [], edges = choice?.edges ?? [];
  const { columns, points, rows } = positionsOf(maps, layersOf(maps, edges));
  const { arrows, endings } = overlayOf(edges, points);
  const width = columns * PATH_COLUMN_WIDTH, height = rows * PATH_ROW_HEIGHT;
  return {
    edges: arrows, endings, height,
    nodes: maps.map((entry, index) => nodeOf(entry, index + 1, points.get(entry.map.id)!, selectedId, i18n)),
    viewBox: `0 0 ${width} ${height}`, width
  };
};
