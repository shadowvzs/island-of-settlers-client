import { findOwnHeadquarters } from "./settlement-home";
import { isGroundSegmentClear, isNavigationClear } from "./settlement-navigation";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

interface WalkComponent { id: number; nodes: number; x: number; z: number }
export interface WalkConnectivity {
  complete: boolean; checked: number; nodes: number; components: WalkComponent[];
  labels: Uint32Array; stride: number; homeComponent?: number;
}
const FORWARD_EDGES = [[1, 0], [0, 1], [1, 1], [-1, 1]] as const;

/** Exhaust the same half-cell/eight-neighbour graph used by shared ground searches, without visit truncation. */
export const inspectWalkingConnectivity = function* (context: SettlementContext, expired: () => boolean)
  : Generator<number, WalkConnectivity> {
  const world = context.options.world, stride = world.cellsX * 2 + 1, rows = world.cellsZ * 2 + 1;
  const count = stride * rows, clear = new Uint8Array(count), labels = new Uint32Array(count);
  const parent = new Uint32Array(count), sizes = new Uint32Array(count);
  const point = (id: number): SettlementPoint => ({ x: (id % stride) / 2, z: Math.floor(id / stride) / 2 });
  const result: WalkConnectivity = { complete: false, checked: 0, nodes: 0, components: [], labels, stride };
  const root = (id: number): number => {
    while (parent[id] !== id) { parent[id] = parent[parent[id]!]!; id = parent[id]!; }
    return id;
  };
  for (let id = 0; id < count; id++) {
    if (id % 256 === 0) { yield id; if (expired()) return result; }
    result.checked++;
    if (!isNavigationClear(context, point(id))) continue;
    clear[id] = 1; parent[id] = id; sizes[id] = 1; result.nodes++;
  }
  for (let id = 0; id < count; id++) {
    if (id % 128 === 0) { yield count + id; if (expired()) return result; }
    if (!clear[id]) continue;
    const x = id % stride, z = Math.floor(id / stride), from = point(id);
    // Four forward edges cover the undirected eight-neighbour graph exactly once.
    for (const [dx, dz] of FORWARD_EDGES) {
      const nx = x + dx!, nz = z + dz!, next = nz * stride + nx;
      if (nx < 0 || nx >= stride || nz >= rows || !clear[next] ||
        !isGroundSegmentClear(context, from, point(next))) continue;
      let a = root(id), b = root(next); if (a === b) continue;
      if (sizes[a]! < sizes[b]!) [a, b] = [b, a];
      parent[b] = a; sizes[a] = sizes[a]! + sizes[b]!;
    }
  }
  const groups = new Map<number, WalkComponent>();
  for (let id = 0; id < count; id++) {
    if (id % 1024 === 0) { yield count * 2 + id; if (expired()) return result; }
    if (!clear[id]) continue;
    const key = root(id); let group = groups.get(key);
    if (!group) { group = { id: groups.size + 1, nodes: 0, ...point(id) }; groups.set(key, group); }
    labels[id] = group.id; group.nodes++;
  }
  result.components = [...groups.values()].sort((a, b) => b.nodes - a.nodes);
  const home = findOwnHeadquarters(context);
  if (home) result.homeComponent = labels[Math.round(home.access.z * 2) * stride + Math.round(home.access.x * 2)] || undefined;
  result.complete = true; return result;
};
