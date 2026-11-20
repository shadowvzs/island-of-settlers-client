import type { WorldData } from "../../../src/shared/world/world-data";

export interface TerrainAuthorization {
  reason: string;
  /** World-space bounds including only the documented transition margin. */
  minX: number; maxX: number; minZ: number; maxZ: number;
  layers: readonly string[];
}
const LAYERS = ["heights", "waterDepth", "waterSurface", "normals", "walkCost", "buildClass",
  "blocking", "mineZone", "oreAmount", "clearedStoneGround"] as const;
export interface TerrainSnapshot {
  cellsX: number; cellsZ: number;
  layers: Record<string, number[]>;
  props?: Array<{ type: number; x: number; z: number; y: number;
    scale: number; rotation: number; phase: number; form: number }>;
}
/** Take only at checkpoints, not each frame. Arrays are detached copies of authoritative data. */
export const snapshotTerrain = (world: WorldData): TerrainSnapshot => {
  const layers: Record<string, number[]> = {};
  for (const key of LAYERS) {
    const value = (world as unknown as Record<string, unknown>)[key];
    if (ArrayBuffer.isView(value)) layers[key] = Array.from(value as unknown as ArrayLike<number>);
  }
  const props = Array.from({ length: world.props.count }, (_, index) => ({
    type: world.props.types[index]!, x: world.props.x[index]!, z: world.props.z[index]!, y: world.props.y[index]!,
    scale: world.props.scale[index]!, rotation: world.props.rotation[index]!,
    phase: world.props.phase[index]!, form: world.props.form[index]!
  }));
  return { cellsX: world.cellsX, cellsZ: world.cellsZ, layers, props };
};

export const compareTerrain = (
  before: TerrainSnapshot, after: TerrainSnapshot, authorized: readonly TerrainAuthorization[] = [], tolerance = 1e-5
) => {
  if (before.cellsX !== after.cellsX || before.cellsZ !== after.cellsZ)
    return { compatible: false, changed: 0, unauthorized: 0, nonFinite: 0, examples: [] };
  let changed = 0, unauthorized = 0, nonFinite = 0;
  const examples: Array<{ layer: string; index: number; x: number; z: number; before: number; after: number }> = [];
  for (const layer of new Set([...Object.keys(before.layers), ...Object.keys(after.layers)])) {
    const left = before.layers[layer] ?? [], right = after.layers[layer] ?? [];
    const vertex = ["heights", "waterDepth", "waterSurface", "normals"].includes(layer);
    const stride = vertex ? before.cellsX + 1 : before.cellsX;
    const components = layer === "normals" ? 3 : 1;
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const a = left[index] ?? 0, b = right[index] ?? 0;
      if (!Number.isFinite(b)) nonFinite++;
      if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance) continue;
      changed++;
      const point = Math.floor(index / components), x = point % stride, z = Math.floor(point / stride);
      if (authorized.some(area => area.layers.includes(layer) && x >= area.minX && x <= area.maxX &&
        z >= area.minZ && z <= area.maxZ)) continue;
      unauthorized++;
      if (examples.length < 64) examples.push({ layer, index, x, z, before: a, after: b });
    }
  }
  const oldProps = before.props ?? [], newProps = after.props ?? [];
  for (let index = 0; index < Math.max(oldProps.length, newProps.length); index++) {
    const a = oldProps[index], b = newProps[index];
    if (a && b && a.type === b.type && Math.abs(a.x - b.x) <= tolerance &&
      Math.abs(a.z - b.z) <= tolerance && Math.abs(a.y - b.y) <= tolerance &&
      Math.abs(a.scale - b.scale) <= tolerance && Math.abs(a.rotation - b.rotation) <= tolerance &&
      Math.abs(a.phase - b.phase) <= tolerance && a.form === b.form) continue;
    changed++;
    const point = b ?? a!;
    if (authorized.some(area => area.layers.includes("props") && point.x >= area.minX && point.x <= area.maxX &&
      point.z >= area.minZ && point.z <= area.maxZ)) continue;
    unauthorized++;
    if (examples.length < 64) examples.push({ layer: "props", index, x: point.x, z: point.z,
      before: a?.type ?? -1, after: b?.type ?? -1 });
  }
  return { compatible: true, changed, unauthorized, nonFinite, examples };
};
