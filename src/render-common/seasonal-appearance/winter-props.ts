import type { PropMesh } from "../props/mesh-builder";
import { SNOW_PALETTE } from "../snow-palette";
import { getWinterFoliageKind } from "./winter-foliage-kind";

export type WinterPropKind = "tree" | "shrub" | "grass" | "stone";
const winterProps = new WeakMap<PropMesh, Map<WinterPropKind, PropMesh>>();
const SNOW = SNOW_PALETTE.winterPropsSnow;
const DRY = [.36, .25, .14] as const;
const FOLIAGE_KIND_VALUE = { deciduous: 2, evergreen: 1, wood: 0 } as const;

/** Connected leaf-card components keep both triangles, including reversed/back-facing indices. */
const classifyFoliage = (source: PropMesh) => {
  const count = source.positions.length / 3;
  const parent = Int32Array.from({ length: count }, (_, index) => index);
  const kinds = new Uint8Array(count);
  const root = (vertex: number): number => {
    let current = vertex;
    while (parent[current] !== current) current = parent[current]!;
    while (parent[vertex] !== vertex) {
      const next = parent[vertex]!; parent[vertex] = current; vertex = next;
    }
    return current;
  };
  for (let offset = 0; offset < source.indices.length; offset += 3) {
    const a = source.indices[offset]!, b = source.indices[offset + 1]!, c = source.indices[offset + 2]!;
    // The centroid is inside the atlas cell; edge UVs may lie exactly on its neighbour's boundary.
    const u = (source.uvs[a * 2]! + source.uvs[b * 2]! + source.uvs[c * 2]!) / 3;
    const v = (source.uvs[a * 2 + 1]! + source.uvs[b * 2 + 1]! + source.uvs[c * 2 + 1]!) / 3;
    const kind = getWinterFoliageKind(u, v);
    const value = FOLIAGE_KIND_VALUE[kind];
    kinds[a] = Math.max(kinds[a]!, value); kinds[b] = Math.max(kinds[b]!, value);
    kinds[c] = Math.max(kinds[c]!, value);
    if (value !== 2) continue;
    const smallest = Math.min(root(a), root(b), root(c));
    parent[root(a)] = smallest; parent[root(b)] = smallest; parent[root(c)] = smallest;
  }
  const keep = new Uint8Array(count);
  for (let vertex = 0; vertex < count; vertex++) {
    const component = root(vertex);
    // Integer component identity, stable for full/core/minimal index lists and across reloads.
    let hash = Math.imul(component + 17, 0x45d9f3b);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    keep[vertex] = Number(((hash ^ (hash >>> 16)) >>> 0) / 4294967296 < .12);
  }
  return { keep, kinds };
};

const filterIndices = (indices: Uint16Array, kinds: Uint8Array, keep: Uint8Array) => {
  const retained: number[] = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset]!, b = indices[offset + 1]!, c = indices[offset + 2]!;
    if (kinds[a] === 2 && kinds[b] === 2 && kinds[c] === 2 && !keep[a]) continue;
    retained.push(a, b, c);
  }
  return Uint16Array.from(retained);
};

/** One immutable cached appearance per canonical mesh/kind; no per-frame transforms or new vertices. */
export const getWinterPropMesh = (source: PropMesh, kind: WinterPropKind = "tree"): PropMesh => {
  const cached = winterProps.get(source)?.get(kind);
  if (cached) return cached;
  const { keep, kinds } = classifyFoliage(source), colors = source.colors.slice();
  for (let vertex = 0; vertex < kinds.length; vertex++) {
    const offset = vertex * 3, r = colors[offset]!, g = colors[offset + 1]!, b = colors[offset + 2]!;
    const luminance = r * .3 + g * .59 + b * .11;
    const dryCover = kind === "grass" || (kind === "shrub" && g > r * .95 && g > b * 1.15);
    const dry = kinds[vertex] === 2 || dryCover;
    const texturedLeaf = kinds[vertex] !== 0 && source.uvs[vertex * 2]! >= 0;
    const normalY = source.normals[offset + 1]!;
    let snow = Math.max(0, Math.min(1, (normalY - .18) / .65)) * .86;
    if (kind === "grass") {
      const tip = Math.max(0, Math.min(1, (source.positions[offset + 1]! / Math.max(.001, source.height) - .65) / .35));
      snow *= tip * .25;
    }
    for (let channel = 0; channel < 3; channel++) {
      let color = colors[offset + channel]!;
      // The seasonal atlas owns leaf hue; a neutral vertex tint avoids multiplying dry brown twice.
      if (texturedLeaf) color = .65 + luminance * .35;
      else if (dry) color = DRY[channel]! * (.6 + luminance * 2.5);
      colors[offset + channel] = Math.min(1, color + (SNOW[channel]! - color) * snow);
    }
  }
  const indices = filterIndices(source.indices, kinds, keep);
  const coreIndexCount = source.coreIndexCount === undefined ? undefined :
    filterIndices(source.indices.subarray(0, source.coreIndexCount), kinds, keep).length;
  const minimalIndices = source.minimalIndices && filterIndices(source.minimalIndices, kinds, keep);
  const result = { ...source, colors, coreIndexCount, indices, minimalIndices };
  let byKind = winterProps.get(source);
  if (!byKind) { byKind = new Map(); winterProps.set(source, byKind); }
  byKind.set(kind, result);
  return result;
};
