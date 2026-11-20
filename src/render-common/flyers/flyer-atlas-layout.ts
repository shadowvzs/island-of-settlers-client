/**
 * The flyer atlas: one square RGBA texture shared by the birds and butterflies. Rows from the
 * top: butterfly wings (a row per species), then the bird feather cells. v = 0 is the first pixel
 * row.
 */
export const FLYER_ATLAS_SIZE = 1024;

export interface AtlasCell {
  height: number;
  width: number;
  x: number;
  y: number;
}

const BUTTERFLY_CELL_SIZE = 128;
/** Pattern variants per butterfly species (individuals differ; the species stays recognisable). */
export const BUTTERFLY_VARIANTS = 3;
/** UV step from one variant's cell to the next (variants sit side by side). */
export const BUTTERFLY_VARIANT_U = BUTTERFLY_CELL_SIZE / FLYER_ATLAS_SIZE;

/**
 * A butterfly species' wing card painting: one atlas row per species, its variants' upper sides
 * then their under sides side by side.
 */
export const getButterflyCell = (species: number, variant: number, under: boolean): AtlasCell => ({
  height: BUTTERFLY_CELL_SIZE,
  width: BUTTERFLY_CELL_SIZE,
  x: ((under ? BUTTERFLY_VARIANTS : 0) + variant) * BUTTERFLY_CELL_SIZE,
  y: species * BUTTERFLY_CELL_SIZE
});

/** Bird wing feathers: u along the span (shoulder .. tip), v along the chord (lead .. trail). */
export const FEATHER_CELL: AtlasCell = { height: 64, width: 256, x: 0, y: 512 };
/** Bird tail feathers: u across the fan, v from the rump to the tip. */
export const TAIL_CELL: AtlasCell = { height: 64, width: 64, x: 256, y: 512 };

/** Texels kept free around a cell's UV range: mipmaps never bleed into a neighbour. */
const CELL_INSET = 2;

/** Atlas UV of a point (u, v in 0..1) of a cell. */
export const toCellUv = (cell: AtlasCell, u: number, v: number): [number, number] => [
  (cell.x + CELL_INSET + u * (cell.width - 2 * CELL_INSET)) / FLYER_ATLAS_SIZE,
  (cell.y + CELL_INSET + v * (cell.height - 2 * CELL_INSET)) / FLYER_ATLAS_SIZE
];

/** Cell point (u, v in 0..1) at the centre of a cell texel: the painters' inverse of toCellUv. */
export const fromCellTexel = (cell: AtlasCell, column: number, row: number) => ({
  u: (column + 0.5 - CELL_INSET) / (cell.width - 2 * CELL_INSET),
  v: (row + 0.5 - CELL_INSET) / (cell.height - 2 * CELL_INSET)
});

/** Writes one texel (colour 0..1, alpha 0..1) of a cell into the atlas pixels. */
export const writeCellTexel = (
  pixels: Uint8Array,
  cell: AtlasCell,
  column: number,
  row: number,
  color: readonly [number, number, number],
  alpha: number
) => {
  const offset = ((cell.y + row) * FLYER_ATLAS_SIZE + cell.x + column) * 4;
  pixels[offset] = Math.round(Math.min(1, Math.max(0, color[0])) * 255);
  pixels[offset + 1] = Math.round(Math.min(1, Math.max(0, color[1])) * 255);
  pixels[offset + 2] = Math.round(Math.min(1, Math.max(0, color[2])) * 255);
  pixels[offset + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
};
