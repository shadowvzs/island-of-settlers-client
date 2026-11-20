import { projectToScreen } from "../iso-projection";
import type { PropMesh } from "../props/mesh-builder";

/** Atlas pixels per screen pixel at zoom 1 (sprites stay sharp up to zoom 2). */
export const BAKE_SCALE = 2;
/** Rendered at twice the atlas size and averaged down: anti-aliased sprite edges. */
export const SUPERSAMPLE = 2;
const PADDING = 3;
const ATLAS_WIDTH = 2048 * SUPERSAMPLE;
/** Browser limit of a canvas / texture side: the atlas never grows past it. */
const MAX_ATLAS_HEIGHT = 16384;
/** Heights are multiples of 2 x SUPERSAMPLE: the half resolution wind map divides evenly. */
const HEIGHT_ROUNDING = SUPERSAMPLE * 2;

/** One rectangle in the supersampled atlas; pivot = where the prop origin lands. */
export interface LayoutEntry {
  height: number;
  meshId: number;
  pivotX: number;
  pivotY: number;
  width: number;
  x: number;
  y: number;
}

const getBounds = (mesh: PropMesh) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const { positions } = mesh;
  for (let index = 0; index < positions.length; index += 3) {
    const { screenX, screenY } = projectToScreen(
      positions[index]!,
      positions[index + 1]!,
      positions[index + 2]!
    );
    minX = Math.min(minX, screenX);
    minY = Math.min(minY, screenY);
    maxX = Math.max(maxX, screenX);
    maxY = Math.max(maxY, screenY);
  }
  return { maxX, maxY, minX, minY };
};

const toEntry = (mesh: PropMesh, meshId: number): LayoutEntry => {
  const bounds = getBounds(mesh);
  const scale = BAKE_SCALE * SUPERSAMPLE;
  const even = (value: number) => Math.ceil(value / SUPERSAMPLE) * SUPERSAMPLE;
  return {
    height: even((bounds.maxY - bounds.minY + PADDING * 2) * scale),
    meshId,
    pivotX: (-bounds.minX + PADDING) * scale,
    pivotY: (-bounds.minY + PADDING) * scale,
    width: even((bounds.maxX - bounds.minX + PADDING * 2) * scale),
    x: 0,
    y: 0
  };
};

const roundHeight = (height: number) => Math.ceil(height / HEIGHT_ROUNDING) * HEIGHT_ROUNDING;

/** Shelf packing (tallest first) into the atlas width; returns the rounded atlas height. */
const packShelves = (ordered: LayoutEntry[]) => {
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const entry of ordered) {
    if (x + entry.width > ATLAS_WIDTH) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    entry.x = x;
    entry.y = y;
    x += entry.width;
    shelf = Math.max(shelf, entry.height);
  }
  return roundHeight(y + shelf);
};

/**
 * Every mesh's sprite (as seen from the iso angle) packed into one atlas; fails loudly if a
 * sprite is wider than the atlas or the atlas outgrew the browser's texture limit.
 */
export const layoutSpriteAtlas = (meshes: PropMesh[]) => {
  const entries: LayoutEntry[] = [];
  meshes.forEach((mesh, meshId) => entries.push(toEntry(mesh, meshId)));
  const ordered = [...entries].sort((a, b) => b.height - a.height);
  const widest = Math.max(0, ...entries.map((entry) => entry.width));
  if (widest > ATLAS_WIDTH) throw new Error(`a sprite (${widest} wide) does not fit the atlas`);
  const height = packShelves(ordered);
  if (height > MAX_ATLAS_HEIGHT) throw new Error(`sprite atlas too tall (${height} rows)`);
  return { entries, height, width: ATLAS_WIDTH };
};

export type AtlasLayout = ReturnType<typeof layoutSpriteAtlas>;
