import type { PropMesh } from "../props/mesh-builder";
import { EVERGREEN_REGIONS } from "../trees/foliage-atlas";

/**
 * R15a hemispherical tree impostor layout: every baked tree mesh gets one block of
 * TREE_VIEW_AZIMUTHS x TREE_VIEW_ELEVATIONS orthographic views (the owner's 8 x 4 grid). Pure
 * CPU code, shared by the worker bake and the renderer.
 */
export const TREE_VIEW_AZIMUTHS = 8;
/** View elevations of the block rows (radians): 0, 22.5, 45 and 67.5 degrees. */
export const TREE_VIEW_ELEVATIONS = [0, 1, 2, 3].map(row => row * Math.PI / 8);
/**
 * Albedo RGBA8 plus a half-resolution normal RGBA8 (1 byte per albedo texel), with the 4/3 mip
 * chain. Far lighting needs no full-resolution normal; the saving buys a sharper silhouette.
 */
const BYTES_PER_TEXEL = (4 + 1) * 4 / 3;
/**
 * Largest view frame side (texels). The card's upper end was 256; at 64 MiB that cap, not the
 * memory, bound the density of this island's largest tree, so it is 320 (R15a-64).
 */
export const TREE_VIEW_MAX_FRAME_TEXELS = 320;
/** Frames are multiples of this, so every mip level of a frame stays texel aligned. */
const FRAME_ALIGN = 8;
/** Transparent border inside each frame (texels): bilinear and mip taps stay in the frame. */
export const TREE_VIEW_MARGIN = 4;
/** The R15a page width; a budget its tallest page cannot hold also tries the wider pages. */
const BASE_ATLAS_WIDTH = 2048;
/** Step between the wider page widths that are tried (shelf packing favours different ones). */
const ATLAS_WIDTH_STEP = 256;
/** Largest atlas side; the baker lowers it to what the GPU's supersampled bake target allows. */
export const TREE_VIEW_MAX_ATLAS_SIDE = 4096;
/** Broadleaf winter blocks keep this share of the leaf clumps (the 3D crown keeps 12 %). */
export const TREE_VIEW_BARE_KEEP = 0.12;

/** Foliage kinds of FOLIAGE_KIND_GLSL. */
export const FOLIAGE = { broadleaf: 1, evergreen: 0.5, wood: 0 } as const;

/** One mesh's view block in the final (not supersampled) atlas. */
export interface TreeViewEntry {
  /** Winter block: broadleaf leaves thinned like the 3D winter crown. */
  bare: boolean;
  /** Foliage kind of the leaves (FOLIAGE): winter colour of the far trees. */
  foliage: number;
  frameHeight: number;
  frameWidth: number;
  meshId: number;
  /** Largest horizontal distance of a vertex from the trunk axis. */
  radius: number;
  x: number;
  y: number;
  yMax: number;
  yMin: number;
}

export interface TreeViewLayout {
  entries: TreeViewEntry[];
  height: number;
  /** Texels per world unit of the frames. */
  texelsPerUnit: number;
  width: number;
}

/** View-space vertical range of the bounding cylinder at an elevation (row of the block). */
export const getViewRange = (entry: Pick<TreeViewEntry, "radius" | "yMax" | "yMin">, elevation: number) => {
  const cos = Math.cos(elevation);
  const sin = Math.sin(elevation);
  return {
    max: entry.yMax * cos + entry.radius * sin,
    min: entry.yMin * cos - entry.radius * sin
  };
};

const getBounds = (mesh: PropMesh) => {
  let radius = 0.01;
  let yMin = Infinity;
  let yMax = -Infinity;
  const { positions } = mesh;
  for (let index = 0; index < positions.length; index += 3) {
    radius = Math.max(radius, Math.hypot(positions[index]!, positions[index + 2]!));
    yMin = Math.min(yMin, positions[index + 1]!);
    yMax = Math.max(yMax, positions[index + 1]!);
  }
  return { radius, yMax, yMin };
};

const isEvergreenUv = (u: number, v: number) => {
  const { needles, palms } = EVERGREEN_REGIONS;
  return (u < needles.u1 && v >= needles.v0 && v < needles.v1) || (v >= palms.v0 && v < palms.v1);
};

/** Majority foliage kind of a mesh's leaf vertices (the CPU twin of getFoliageKind). */
export const getMeshFoliage = (mesh: PropMesh) => {
  let evergreen = 0;
  let broadleaf = 0;
  for (let index = 0; index < mesh.uvs.length; index += 2) {
    const u = mesh.uvs[index]!;
    const v = mesh.uvs[index + 1]!;
    if (u > -1.4 && u < -1.1) broadleaf += 1;
    else if (u >= 0 && isEvergreenUv(u, v)) evergreen += 1;
    else if (u >= 0) broadleaf += 1;
  }
  if (evergreen + broadleaf === 0) return FOLIAGE.wood;
  return evergreen > broadleaf ? FOLIAGE.evergreen : FOLIAGE.broadleaf;
};

/** World size of a block frame: the cylinder width and its tallest row. */
const getFrameWorldSize = (bounds: ReturnType<typeof getBounds>) => {
  const heights = TREE_VIEW_ELEVATIONS.map(elevation => {
    const range = getViewRange(bounds, elevation);
    return range.max - range.min;
  });
  return { height: Math.max(...heights), width: bounds.radius * 2 };
};

const alignFrame = (worldSize: number, texelsPerUnit: number) =>
  Math.ceil((worldSize * texelsPerUnit + TREE_VIEW_MARGIN * 2) / FRAME_ALIGN) * FRAME_ALIGN;

const alignAtlas = (size: number) => Math.max(FRAME_ALIGN, Math.ceil(size / FRAME_ALIGN) * FRAME_ALIGN);

/** Shelf packing (tallest first) of the blocks; returns the used atlas size. */
const packBlocks = (entries: TreeViewEntry[], atlasWidth: number) => {
  const ordered = [...entries].sort((first, second) => second.frameHeight - first.frameHeight);
  let x = 0;
  let y = 0;
  let shelf = 0;
  let used = 0;
  for (const entry of ordered) {
    const width = entry.frameWidth * TREE_VIEW_AZIMUTHS;
    const height = entry.frameHeight * TREE_VIEW_ELEVATIONS.length;
    if (x + width > atlasWidth) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    entry.x = x;
    entry.y = y;
    x += width;
    used = Math.max(used, x);
    shelf = Math.max(shelf, height);
  }
  return { height: alignAtlas(y + shelf), width: alignAtlas(used) };
};

export interface TreeViewSource {
  bare: boolean;
  meshId: number;
}

/** The density-independent part of an entry: measured once, not per density attempt. */
interface MeasuredSource {
  bounds: ReturnType<typeof getBounds>;
  foliage: number;
  size: ReturnType<typeof getFrameWorldSize>;
  source: TreeViewSource;
}

const measureSources = (meshes: readonly PropMesh[], sources: readonly TreeViewSource[]) =>
  sources.map((source): MeasuredSource => {
    const mesh = meshes[source.meshId]!;
    const bounds = getBounds(mesh);
    return { bounds, foliage: getMeshFoliage(mesh), size: getFrameWorldSize(bounds), source };
  });

const createEntries = (measured: readonly MeasuredSource[], density: number) =>
  measured.map(({ bounds, foliage, size, source }): TreeViewEntry => ({
    ...bounds,
    bare: source.bare,
    foliage,
    frameHeight: alignFrame(size.height, density),
    frameWidth: alignFrame(size.width, density),
    meshId: source.meshId,
    x: 0,
    y: 0
  }));

const getAtlasBytes = (width: number, height: number) => width * height * BYTES_PER_TEXEL;

/** The atlas memory budget (`QualityPreset.treeViewAtlasMiB`) and the GPU's atlas side limit. */
export interface TreeViewLimits {
  /** Both maps with their mips stay inside this many bytes. */
  budgetBytes: number;
  /** Largest atlas side (texels) the bake target and the texture upload can take. */
  maxAtlasSide: number;
}

/**
 * Page widths worth packing: the base width alone while its tallest page holds the budget (the
 * 32 MiB layout stays as R15a shipped it), otherwise every wider page up to the side limit too.
 */
const listAtlasWidths = ({ budgetBytes, maxAtlasSide }: TreeViewLimits) => {
  const base = Math.min(BASE_ATLAS_WIDTH, maxAtlasSide);
  const widths = [base];
  if (getAtlasBytes(base, maxAtlasSide) >= budgetBytes) return widths;
  for (let width = base + ATLAS_WIDTH_STEP; width <= maxAtlasSide; width += ATLAS_WIDTH_STEP) widths.push(width);
  return widths;
};

/** Texel density that fills the budget (capped at TREE_VIEW_MAX_FRAME_TEXELS for the largest frame). */
const getStartDensity = (measured: readonly MeasuredSource[], budgetBytes: number) => {
  let area = 0;
  let largest = 0;
  for (const { size } of measured) {
    area += size.width * size.height * TREE_VIEW_AZIMUTHS * TREE_VIEW_ELEVATIONS.length;
    largest = Math.max(largest, size.width, size.height);
  }
  const budgetTexels = budgetBytes / BYTES_PER_TEXEL;
  // The margin and the alignment round-up stay inside the frame cap.
  const contentTexels = TREE_VIEW_MAX_FRAME_TEXELS - TREE_VIEW_MARGIN * 2 - FRAME_ALIGN;
  return Math.min(Math.sqrt(budgetTexels / Math.max(area, 1e-6)), contentTexels / Math.max(largest, 1e-6));
};

/** Density step of the search down from the budget-filling start density. */
const DENSITY_STEP = 0.95;
const DENSITY_ATTEMPTS = 64;

/** Densest layout on a page of `atlasWidth` that fits the limits; null when none does. */
const fitPage = (
  measured: readonly MeasuredSource[],
  atlasWidth: number,
  { budgetBytes, maxAtlasSide }: TreeViewLimits
): TreeViewLayout | null => {
  let density = getStartDensity(measured, budgetBytes);
  for (let attempt = 0; attempt < DENSITY_ATTEMPTS; attempt += 1) {
    const entries = createEntries(measured, density);
    const { height, width } = packBlocks(entries, atlasWidth);
    const fitsSide = width <= atlasWidth && height <= maxAtlasSide;
    if (fitsSide && getAtlasBytes(width, height) <= budgetBytes) {
      return { entries, height, texelsPerUnit: density, width };
    }
    density *= DENSITY_STEP;
  }
  return null;
};

/**
 * Lays out the view blocks of the listed meshes at the highest texel density whose atlas (both
 * maps with mips) stays inside the preset's budget and the GPU's atlas side limit: a smaller
 * limit lowers the density instead of failing. Frames are sized per mesh, so every tree gets the
 * same texels per world unit: a young tree uses a smaller frame than a mature one.
 */
export const layoutTreeViews = (
  meshes: readonly PropMesh[],
  sources: readonly TreeViewSource[],
  limits: TreeViewLimits
): TreeViewLayout => {
  const maxAtlasSide = Math.floor(Math.min(limits.maxAtlasSide, TREE_VIEW_MAX_ATLAS_SIDE) / FRAME_ALIGN) * FRAME_ALIGN;
  const pageLimits = { budgetBytes: limits.budgetBytes, maxAtlasSide };
  const measured = measureSources(meshes, sources);
  let best: TreeViewLayout | null = null;
  for (const atlasWidth of listAtlasWidths(pageLimits)) {
    const layout = fitPage(measured, atlasWidth, pageLimits);
    if (layout && (!best || layout.texelsPerUnit > best.texelsPerUnit)) best = layout;
  }
  if (!best) throw new Error("tree views do not fit the atlas budget");
  return best;
};
