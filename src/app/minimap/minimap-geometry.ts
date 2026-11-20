import type { GridSize } from "../../shared/world/grid-geometry";

/** Iso screen height per unit of screen width (the cell diamond is twice as wide as tall). */
const DIAMOND_RATIO = 0.5;

export interface MinimapPoint {
  x: number;
  y: number;
}

/** A point clamped to the minimap's [0, 1] drawing box, for CSS-percentage overlays. */
export const minimapFraction = (
  point: MinimapPoint,
  width: number,
  height: number
): MinimapPoint => ({
  x: Math.min(1, Math.max(0, point.x / width)),
  y: Math.min(1, Math.max(0, point.y / height))
});

/**
 * The world drawn as the iso diamond of the main view, `width` pixels wide: world (x, z) to
 * minimap pixels and back. North (z = 0, x = 0) is the top corner, like the main camera.
 */
export const createMinimapProjection = (grid: GridSize, width: number) => {
  const scale = width / (grid.cellsX + grid.cellsZ);
  return {
    height: (grid.cellsX + grid.cellsZ) * DIAMOND_RATIO * scale,
    /** Canvas transform that maps the top-down image (one pixel per cell) into the diamond. */
    imageTransform: [scale, DIAMOND_RATIO * scale, -scale, DIAMOND_RATIO * scale] as const,
    imageOffsetX: grid.cellsZ * scale,
    toMinimap: (x: number, z: number): MinimapPoint => ({
      x: (x - z + grid.cellsZ) * scale,
      y: (x + z) * DIAMOND_RATIO * scale
    }),
    toWorld: (point: MinimapPoint) => {
      const difference = point.x / scale - grid.cellsZ;
      const sum = point.y / (DIAMOND_RATIO * scale);
      return { x: (sum + difference) / 2, z: (sum - difference) / 2 };
    },
    width
  };
};
