import { Box2, DataTexture, Vector2, type WebGLRenderer } from "three";

/** RGBA8 atlases only (createAtlasTexture): four bytes per texel. */
const BYTES_PER_TEXEL = 4;
const UNPACK_REGION_PARAMETERS = ["UNPACK_ROW_LENGTH", "UNPACK_IMAGE_HEIGHT", "UNPACK_SKIP_PIXELS",
  "UNPACK_SKIP_ROWS", "UNPACK_SKIP_IMAGES"] as const;

interface TextureLevel {
  data: Uint8Array;
  height: number;
  width: number;
}

/** The CPU levels of a data texture: its explicit mip chain, or the base image (GPU generated mips). */
const getLevels = (texture: DataTexture): TextureLevel[] => {
  if (texture.mipmaps.length > 0) return texture.mipmaps as TextureLevel[];
  return [texture.image as TextureLevel];
};

/**
 * Uploads an RGBA8 data texture in row bands across several calls instead of one blocking upload on
 * its first draw: the first call allocates the GPU storage (all levels, no data), every call then
 * copies at most `maxBytes` of rows (at least one row). The texture object, its parameters and its
 * version stay the same, so the first draw finds it resident and uploads nothing.
 */
export const createSlicedTextureUpload = (renderer: WebGLRenderer, texture: DataTexture) => {
  const levels = getLevels(texture);
  const generateMipmaps = texture.generateMipmaps;
  /** Never uploaded themselves: copyTextureToTexture reads their CPU data (texSubImage2D). */
  const sources = levels.map(level => new DataTexture(level.data, level.width, level.height));
  const region = new Box2();
  const position = new Vector2();
  let allocated = false;
  let level = 0;
  let row = 0;

  const allocate = () => {
    // copyTextureToTexture saves these through three's state cache; unknown entries cost a synchronous
    // getParameter round trip each. WebGL defaults are 0 and three restores them after every copy.
    const gl = renderer.getContext() as WebGL2RenderingContext;
    for (const name of UNPACK_REGION_PARAMETERS) renderer.state.pixelStorei(gl[name], 0);
    texture.source.dataReady = false;
    try {
      renderer.initTexture(texture);
    } finally {
      texture.source.dataReady = true;
    }
    allocated = true;
  };

  /** Copies one band of the current level; returns the bytes sent. */
  const copyBand = (maxBytes: number) => {
    const { height, width } = levels[level]!;
    const rows = Math.max(1, Math.min(height - row, Math.floor(maxBytes / (width * BYTES_PER_TEXEL))));
    region.min.set(0, row);
    region.max.set(width, row + rows);
    position.set(0, row);
    // GPU mips (no CPU chain) are generated once, from the complete base level.
    texture.generateMipmaps = generateMipmaps && row + rows === height;
    try {
      renderer.copyTextureToTexture(sources[level]!, texture, region, position, 0, level);
    } finally {
      texture.generateMipmaps = generateMipmaps;
    }
    row += rows;
    if (row === height) {
      level += 1;
      row = 0;
    }
    return rows * width * BYTES_PER_TEXEL;
  };

  /** Sends up to `maxBytes` (at least one row); true once every level is resident. */
  const step = (maxBytes: number) => {
    if (!allocated) allocate();
    let remaining = maxBytes;
    while (level < levels.length && remaining > 0) remaining -= copyBand(remaining);
    return level >= levels.length;
  };

  return {
    /** Bytes of every level (diagnostics and budgeting). */
    bytes: levels.reduce((sum, item) => sum + item.width * item.height * BYTES_PER_TEXEL, 0),
    step
  };
};
