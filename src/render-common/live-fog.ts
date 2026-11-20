import type { WorldData } from "../shared/world/world-data";
import { createVertexFog } from "./chunk-sampling";

/** A composed display-fog texture supplied by a transient presentation-only owner. */
export interface LiveFogDisplayFrame {
  readonly height: number;
  readonly pixels: Uint8Array;
  /** Increments whenever `pixels` changed. */
  readonly revision: number;
  readonly width: number;
}

/**
 * A renderer-only display override. `null` means "use the authoritative base fog"; the live fog then
 * recomposes from the current `world.fog` rather than restoring a saved texture snapshot.
 */
export interface LiveFogDisplayProvider {
  displayFog(): LiveFogDisplayFrame | null;
}

/**
 * Cell-centred RGBA fog texture, shared by every terrain/prop shader. The optional display provider
 * (EXPLORE-01E) only changes what this texture uploads; the returned buffer and its ownership stay
 * here, and every gameplay fog consumer continues to read `world.fog` directly.
 */
export const createLiveFog = (world: WorldData, displayProvider?: LiveFogDisplayProvider) => {
  const pixels = new Uint8Array(world.cellsX * world.cellsZ * 4);
  const vertexCount = (world.cellsX + 1) * (world.cellsZ + 1);
  const workspace = {
    vertices: new Float32Array(vertexCount),
    sums: new Uint32Array(vertexCount)
  };
  let revision = -1;
  let displayActive = false;
  let displayPixels: Uint8Array | null = null;
  let displayRevision = -1;

  const rebuildBase = () => {
    revision = world.fogRevision ?? 0;
    const vertices = createVertexFog(world, workspace),
      stride = world.cellsX + 1;
    for (let z = 0; z < world.cellsZ; z++)
      for (let x = 0; x < world.cellsX; x++) {
        const v = z * stride + x,
          value = Math.round(
            ((vertices[v]! + vertices[v + 1]! + vertices[v + stride]! + vertices[v + stride + 1]!) *
              255) /
              4
          );
        const p = (z * world.cellsX + x) * 4;
        pixels[p] = pixels[p + 1] = pixels[p + 2] = value;
        pixels[p + 3] = 255;
      }
    return true;
  };

  const copyDisplay = (frame: LiveFogDisplayFrame) => {
    if (frame.width !== world.cellsX || frame.height !== world.cellsZ ||
      frame.pixels.length !== pixels.length)
      throw new Error("Invalid live fog display frame");
    // The provider owns its buffer; this texture buffer is the renderer's shared resource.
    if (frame.pixels !== pixels) pixels.set(frame.pixels);
    displayActive = true;
    displayPixels = frame.pixels;
    displayRevision = frame.revision;
  };

  const update = () => {
    const display = displayProvider?.displayFog() ?? null;
    if (display) {
      if (displayActive && displayRevision === display.revision && displayPixels === display.pixels)
        return false;
      copyDisplay(display);
      return true;
    }
    if (displayActive) {
      // The transient display is gone: recompose from the current authoritative fog.
      displayActive = false;
      displayPixels = null;
      displayRevision = -1;
      return rebuildBase();
    }
    if (revision === (world.fogRevision ?? 0)) return false;
    return rebuildBase();
  };
  update();
  return { pixels, width: world.cellsX, height: world.cellsZ, update };
};
