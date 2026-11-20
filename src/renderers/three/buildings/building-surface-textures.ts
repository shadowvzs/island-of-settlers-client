import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture
} from "three";

import type { BuildingSurfacePaint } from "../../../render-common/content-builders";
import { shouldRetainTextureSource } from "../../../render-common/texture-source-retention";
import { paintBuildingSurface, surfacePaintKey } from "./building-surface-paint";
import type { SurfacePixels } from "./building-surface-pixels";

/** Surface maps painted ahead (world workers, island cache) by `surfacePaintKey`. */
export type PaintedSurfaces = ReadonlyMap<string, SurfacePixels>;
interface UploadedSurface { maps: SurfacePixels; paint: BuildingSurfacePaint; textures: DataTexture[] }
const uploaded = new WeakMap<PaintedSurfaces, Set<UploadedSurface>>();
const retainedTextures = new Set<Texture>();

/** Releases the WebGPU-only CPU copies after the presenter is disposed. */
export const releaseRetainedTextureSources = () => {
  for (const texture of retainedTextures) delete texture.userData.webgpuSourcePixels;
  retainedTextures.clear();
};

/** Context restoration rebuilds released pixels; shared ghosts keep the same GPU textures. */
export const restoreSurfacePixels = (painted: PaintedSurfaces) => {
  for (const surface of uploaded.get(painted) ?? []) {
    const maps = paintBuildingSurface(surface.paint);
    surface.textures.forEach((texture, index) => {
      surface.maps[index] = maps[index]!;
      texture.image.data = maps[index]!;
      if (shouldRetainTextureSource()) {
        texture.userData.webgpuSourcePixels = maps[index]!;
        retainedTextures.add(texture);
      }
      texture.needsUpdate = true;
    });
  }
};

/** Tiling, filtering hints and colour space shared by every surface map (albedo is sRGB). */
const configure = <T extends Texture>(texture: T, index: number) => {
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  texture.userData.mimeType = "image/jpeg";
  if (index === 0) texture.colorSpace = SRGBColorSpace;
  return texture;
};

/**
 * Worker pixels uploaded as they are: flipped on upload and mipmapped like a canvas texture, so
 * the result matches the page-painted maps texel for texel (no canvas copy kept).
 */
const toDataTextures = (maps: SurfacePixels, resolution: number) =>
  maps.map((pixels, index) => {
    const texture = new DataTexture(pixels, resolution, resolution);
    texture.flipY = true;
    texture.generateMipmaps = true;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    return configure(texture, index);
  });

/** Canvas textures for the tools: the GLB exporter reads canvases back. */
const toCanvasTextures = (maps: SurfacePixels, resolution: number) =>
  maps.map((pixels, index) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = resolution;
    canvas.getContext("2d")!.putImageData(new ImageData(pixels, resolution, resolution), 0, 0);
    return configure(new CanvasTexture(canvas), index);
  });

/** The maps of one surface: prepainted when the loader painted them, else painted here. */
export const createSurfaceTextures = (paint: BuildingSurfacePaint, painted?: PaintedSurfaces): Texture[] => {
  const prepainted = painted?.get(surfacePaintKey(paint));
  // Released after an earlier upload (a pack disposed and made again): painted here instead.
  if (prepainted?.every(map => map.length > 0)) {
    const textures = toDataTextures(prepainted, paint.resolution);
    let groups = uploaded.get(painted!);
    if (!groups) { groups = new Set(); uploaded.set(painted!, groups); }
    const surface = { maps: prepainted, paint, textures };
    groups.add(surface);
    let disposed = 0;
    textures.forEach((texture, index) => {
      if (shouldRetainTextureSource()) {
        texture.userData.webgpuSourcePixels = prepainted[index]!;
        retainedTextures.add(texture);
      }
      texture.onUpdate = () => {
        texture.image.data = null;
        // Also release references in the shared builder promises and painted map.
        prepainted[index] = new Uint8ClampedArray(0);
      };
      texture.addEventListener("dispose", () => {
        retainedTextures.delete(texture);
        if (++disposed === textures.length) groups!.delete(surface);
      });
    });
    return textures;
  }
  return toCanvasTextures(paintBuildingSurface(paint), paint.resolution);
};
