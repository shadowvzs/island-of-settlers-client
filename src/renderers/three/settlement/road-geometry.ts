import { BufferGeometry, Float32BufferAttribute } from "three";

import { BRIDGE_LANDING_LENGTH, BRIDGE_TIMBER_ROAD_DROP } from "../../../render-common/bridges/wood-bridge-recipe";
import { BRIDGE_STRUCTURE_HALF_WIDTH, bridgeDecks, deckCoordinates } from "../../../shared/settlement/bridge-deck";
import { compactRoadSegments, createRoadBend } from "../../../shared/settlement/road-curves";
import {
  ROAD_TIERS,
  ROAD_WIDTH,
  type RoadPoint,
  roadRibbonWidth,
  type RoadSegment,
  type RoadTier
} from "../../../shared/settlement/road-types";
import { createRoadEdgePebbles, type PebbleSample } from "./road-edge-pebbles";
import { createRoadSurfaceProfile } from "./road-surface-profile";

type Incident = { segment: RoadSegment; other: RoadPoint; length: number };
type RoadNode = { point: RoadPoint; incidents: Incident[]; doorway: boolean };
const key = (point: RoadPoint) => `${point.x}:${point.z}`;
const roadNodes = (segments: RoadSegment[]) => {
  const nodes = new Map<string, RoadNode>();
  for (const segment of segments) {
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.z - segment.start.z);
    if (length < 0.00001) continue;
    for (const [point, other] of [
      [segment.start, segment.end],
      [segment.end, segment.start]
    ]) {
      const node = nodes.get(key(point!)) ?? { point: point!, incidents: [], doorway: false };
      node.incidents.push({ segment, other: other!, length });
      // Doorway segments are authored towards the threshold. Only that terminal end is flat.
      node.doorway ||= Boolean(segment.doorway && point === segment.end);
      nodes.set(key(point!), node);
    }
  }
  return nodes;
};
/** Ribbon width where an incident segment meets its node. */
const incidentWidth = (incident: Incident, point: RoadPoint) =>
  roadRibbonWidth(incident.segment, key(incident.segment.start) === key(point) ? 0 : 1);
/** Widest ribbon of one tier meeting at a node: its cap and the bend radius follow it. */
const nodeWidth = (node: RoadNode, tier: RoadTier) => node.incidents.reduce((widest, incident) =>
  incident.segment.tier === tier ? Math.max(widest, incidentWidth(incident, node.point)) : widest, 0) || ROAD_WIDTH;
/**
 * Outward heading (radians, away from the deck) when the node is a bridge anchor where shore roads
 * meet the deck: its cap becomes a half disc on the shore side, so the deck starts on one clean
 * straight seam across its anchor instead of under a round patch of the shore road's paving.
 */
const bridgeAnchorHeading = (node: RoadNode) => {
  const deck = node.incidents.find(incident => incident.segment.bridge);
  if (!deck || !node.incidents.some(incident => !incident.segment.bridge)) return null;
  return Math.atan2(node.point.z - deck.other.z, node.point.x - deck.other.x);
};
/** Angular range of a node cap: a full disc, the shore half at a bridge anchor, or none (the deck tier). */
const capArc = (node: RoadNode, tier: RoadTier) => {
  const heading = bridgeAnchorHeading(node);
  if (heading === null) return { start: 0, sweep: Math.PI * 2 };
  // The deck's own tier ends straight at its anchor; only shore road tiers cap the landing.
  const shore = node.incidents.some(incident => !incident.segment.bridge && incident.segment.tier === tier);
  return shore ? { start: heading - Math.PI / 2, sweep: Math.PI } : null;
};
/** A wooden deck is timber drawn by the bridge model (owner 2026-11-07); only its anchors shape the road. */
const isTimberDeck = (segment: RoadSegment) => segment.bridge?.kind === "wood";

/**
 * Drop of the road surface at a point: inside a wooden deck's structure, from one landing's outer end
 * to the other's (owner 2026-11-07: the timber lies on top of the road at both mouths).
 */
const timberCover = (segments: readonly RoadSegment[]) => {
  const decks = bridgeDecks(segments.filter(isTimberDeck));
  if (!decks.length) return () => 0;
  return (x: number, z: number) => decks.some(deck => {
    const { across, along } = deckCoordinates(deck, { x, z });
    return along >= -BRIDGE_LANDING_LENGTH && along <= deck.length + BRIDGE_LANDING_LENGTH &&
      Math.abs(across) <= BRIDGE_STRUCTURE_HALF_WIDTH;
  }) ? BRIDGE_TIMBER_ROAD_DROP : 0;
};

const curvedJoin = (node: RoadNode, tier: RoadTier) => {
  if (node.doorway || node.incidents.length !== 2) return null;
  if (node.incidents.some(incident => isTimberDeck(incident.segment))) return null;
  const [first, second] = node.incidents as [Incident, Incident];
  if (first.segment.tier !== tier || second.segment.tier !== tier) return null;
  const width = Math.min(incidentWidth(first, node.point), incidentWidth(second, node.point));
  const bend = createRoadBend(first.other, node.point, second.other, width);
  return bend && { ...bend, first, second, width };
};
/** Fractions of the full segment covered by its piece between two (bend-trimmed) points. */
const pieceFractions = (segment: RoadSegment, start: RoadPoint, end: RoadPoint) => {
  const length = Math.hypot(segment.end.x - segment.start.x, segment.end.z - segment.start.z) || 1;
  const along = (point: RoadPoint) => Math.hypot(point.x - segment.start.x, point.z - segment.start.z) / length;
  return { from: along(start), to: along(end) };
};

/** Terrain-sampled circular bends and feathered ribbons, still only one mesh per road tier. */
export const createRoadGeometry = (
  segments: RoadSegment[],
  tier: RoadTier,
  detailed: boolean,
  height: (x: number, z: number) => number,
  previewOnly = false,
  collectPebbles?: (geometry: BufferGeometry) => void
) => {
  segments = compactRoadSegments(segments);
  const positions: number[] = [],
    colors: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const nodes = roadNodes(segments);
  const underTimber = timberCover(segments);
  const pebbleRibbons: PebbleSample[][] = [];
  const profileRibbons: { point: RoadPoint; width?: number }[][] = [];
  const bends = new Map([...nodes].map(([id, node]) => [id, curvedJoin(node, tier)]));
  // Shared world coordinates make every overlapping ribbon/cap shade identically.
  const vertex = (x: number, z: number, alpha: number) => {
    const index = positions.length / 3;
    positions.push(x, height(x, z) + .018 - underTimber(x, z), z);
    uv.push(x, z);
    colors.push(1, 1, 1, alpha);
    return index;
  };
  const sides = detailed ? [-0.5, -0.42, -0.24, 0, 0.24, 0.42, 0.5] : [-0.5, -0.42, -0.36, 0.36, 0.42, 0.5];
  const ribbon = (
    samples: { point: RoadPoint; normal: RoadPoint; distance: number; radius?: number; width?: number }[]
  ) => {
    profileRibbons.push(samples);
    if (!previewOnly && collectPebbles) pebbleRibbons.push(samples);
    const first = positions.length / 3;
    for (const sample of samples)
      for (const side of sides) {
        const edge = Math.abs(side) === 0.5;
        const jitter = edge ? Math.sin(sample.point.x * 37.3 + sample.point.z * 29.1) * 0.011 : 0;
        let offset = side * (sample.width ?? ROAD_WIDTH) + jitter;
        // Extremely short grid bends collapse their inner edge instead of folding triangles backwards.
        if (sample.radius !== undefined) offset = Math.max(offset, -sample.radius * 0.98);
        const x = sample.point.x + sample.normal.x * offset,
          z = sample.point.z + sample.normal.z * offset;
        vertex(x, z, edge ? 0 : 1);
      }
    for (let row = 0; row < samples.length - 1; row++)
      for (let column = 0; column < sides.length - 1; column++) {
        const a = first + row * sides.length + column,
          b = a + 1,
          c = a + sides.length,
          d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
  };
  for (const segment of segments) {
    if (segment.tier !== tier || (previewOnly && !segment.preview) || isTimberDeck(segment)) continue;
    const startBend = bends.get(key(segment.start)),
      endBend = bends.get(key(segment.end));
    const trimmed = (bend: ReturnType<typeof curvedJoin>, point: RoadPoint) => {
      if (!bend) return point;
      return bend.first.segment === segment ? bend.start : bend.end;
    };
    const start = trimmed(startBend ?? null, segment.start),
      end = trimmed(endBend ?? null, segment.end);
    const dx = end.x - start.x,
      dz = end.z - start.z,
      length = Math.hypot(dx, dz);
    if (length < 0.00001) continue;
    const steps = detailed
      ? Math.max(2, Math.ceil(length / 0.35))
      : Math.max(1, Math.ceil(length / 0.7));
    const { from, to } = pieceFractions(segment, start, end);
    ribbon(
      Array.from({ length: steps + 1 }, (_, index) => ({
        point: { x: start.x + (dx * index) / steps, z: start.z + (dz * index) / steps },
        normal: { x: -dz / length, z: dx / length },
        distance: start.x + start.z + (length * index) / steps,
        width: roadRibbonWidth(segment, from + (to - from) * index / steps)
      }))
    );
  }
  for (const [id, node] of nodes) {
    if (previewOnly && !node.incidents.some(incident => incident.segment.preview)) continue;
    const bend = bends.get(id);
    if (bend) {
      const steps = detailed ? 12 : 6;
      // Clockwise travel makes the left normal point outwards; counterclockwise is reversed.
      const reverse = bend.sweep > 0;
      const angleStart = reverse ? bend.startAngle + bend.sweep : bend.startAngle;
      const sweep = reverse ? -bend.sweep : bend.sweep;
      ribbon(
        Array.from({ length: steps + 1 }, (_, index) => {
          const angle = angleStart + (sweep * index) / steps;
          return {
            point: {
              x: bend.centre.x + Math.cos(angle) * bend.radius,
              z: bend.centre.z + Math.sin(angle) * bend.radius
            },
            normal: { x: Math.cos(angle), z: Math.sin(angle) },
            radius: bend.radius,
            width: bend.width,
            distance: node.point.x + node.point.z + (bend.radius * Math.abs(sweep) * index) / steps
          };
        })
      );
      continue;
    }
    if (node.doorway || !node.incidents.some((incident) => incident.segment.tier === tier))
      continue;
    // Collinear degree-two connections already meet exactly: avoid raised patches there.
    if (
      node.incidents.length === 2 &&
      node.incidents.every((incident) => incident.segment.tier === tier)
    )
      continue;
    const arc = capArc(node, tier);
    if (!arc) continue;
    const count = detailed ? 12 : 6;
    const capWidth = nodeWidth(node, tier);
    if (!previewOnly && collectPebbles && node.incidents.length === 1) {
      const other = node.incidents[0]!.other;
      const heading = Math.atan2(node.point.z - other.z, node.point.x - other.x);
      pebbleRibbons.push(Array.from({ length: 13 }, (_, index) => {
        const angle = heading - Math.PI / 2 + index / 12 * Math.PI;
        const normal = { x: Math.cos(angle), z: Math.sin(angle) };
        return { capEdge: true, normal, point: {
          x: node.point.x + normal.x * capWidth * .5,
          z: node.point.z + normal.z * capWidth * .5
        } };
      }));
    }
    const centre = vertex(node.point.x, node.point.z, 1);
    for (let ring = 0; ring < 2; ring++)
      for (let index = 0; index <= count; index++) {
        const angle = arc.start + (index * arc.sweep) / count;
        const radius = capWidth * (ring ? 0.5 : 0.38);
        vertex(
          node.point.x + Math.cos(angle) * radius,
          node.point.z + Math.sin(angle) * radius,
          ring ? 0 : 1
        );
      }
    for (let index = 0; index < count; index++) {
      const a = centre + 1 + index,
        b = a + 1,
        c = a + count + 1,
        d = c + 1;
      indices.push(centre, b, a, a, b, c, b, d, c);
    }
  }
  {
    // Coverage includes the other tier too: upgrading a branch must not create a shoulder seam.
    for (const segment of segments) if (segment.tier !== tier || (previewOnly && !segment.preview)) {
      const otherStart = curvedJoin(nodes.get(key(segment.start))!, segment.tier);
      const otherEnd = curvedJoin(nodes.get(key(segment.end))!, segment.tier);
      const trimmed = (bend: ReturnType<typeof curvedJoin>, point: RoadPoint) => {
        if (!bend) return point;
        return bend.first.segment === segment ? bend.start : bend.end;
      };
      const start = trimmed(otherStart, segment.start), end = trimmed(otherEnd, segment.end);
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      const steps = Math.max(detailed ? 2 : 1, Math.ceil(length / (detailed ? .35 : .7)));
      const { from, to } = pieceFractions(segment, start, end);
      profileRibbons.push(Array.from({ length: steps + 1 }, (_, index) => ({
        point: { x: start.x + (end.x - start.x) * index / steps, z: start.z + (end.z - start.z) * index / steps },
        width: roadRibbonWidth(segment, from + (to - from) * index / steps)
      })));
    }
    for (const node of nodes.values()) for (const otherTier of ROAD_TIERS) {
      if (otherTier === tier) continue;
      const other = curvedJoin(node, otherTier);
      if (other) profileRibbons.push(Array.from({ length: detailed ? 13 : 7 }, (_, index) => {
        const angle = other.startAngle + other.sweep * index / (detailed ? 12 : 6);
        return { point: { x: other.centre.x + Math.cos(angle) * other.radius,
          z: other.centre.z + Math.sin(angle) * other.radius }, width: other.width };
      }));
    }
    const profile = createRoadSurfaceProfile(profileRibbons);
    if (collectPebbles && !previewOnly)
      // Edge stones under the timber sink with the road.
      collectPebbles(createRoadEdgePebbles(pebbleRibbons, profile, (x, z) => height(x, z) - underTimber(x, z) * 2,
        detailed, tier));
    for (let index = 0; index < positions.length; index += 3)
      positions[index + 1]! += profile(positions[index]!, positions[index + 2]!);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};
