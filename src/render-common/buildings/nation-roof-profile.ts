/** "japanese-pyramid": the hip roof without a ridge (hogyo), the crown of a pagoda. */
export type NationRoofProfile = "viking" | "japanese" | "japanese-pyramid";

export const isJapaneseRoofProfile = (profile: NationRoofProfile) => profile !== "viking";

/** Half the ridge length in unit roof: a hip ridge runs along the middle half, a pyramid has none. */
export const japaneseRidgeHalf = (profile: NationRoofProfile) => profile === "japanese-pyramid" ? 0 : .25;

/** Unit slope position (0 ridge … 1 eave) of a hip end, falling along local z. */
export const japaneseEndSlope = (profile: NationRoofProfile, z: number) => {
  const ridge = japaneseRidgeHalf(profile);
  return Math.max(0, (Math.abs(z) * 2 - ridge * 2) / (1 - ridge * 2));
};

/**
 * Vertex grid. Japanese: rows land on the ridge ends (quarters), and across = along / 2 puts every
 * hip crease exactly on cell diagonals, so the hips are crisp straight folds.
 */
export const nationRoofGrid = (profile: NationRoofProfile, detailed: boolean, compact = false) => {
  if (compact && !detailed && profile === "japanese-pyramid") return { across: 2, along: 2 };
  // Viking height is constant along z; one longitudinal strip preserves the exact Minimal surface.
  if (profile === "viking") return detailed ? { across: 10, along: 6 } : { across: 4, along: 1 };
  if (profile === "japanese-pyramid") return detailed ? { across: 8, along: 8 } : { across: 4, along: 4 };
  return detailed ? { across: 8, along: 16 } : { across: 4, along: 8 };
};

/** Japanese cells split along their hip-parallel diagonal (column, row) to (column + 1, row + 1). */
export const nationRoofMainDiagonal = (profile: NationRoofProfile, x: number, z: number) =>
  isJapaneseRoofProfile(profile) && x * z > 0;

/**
 * Unit-roof height (local x, z and result all in -0.5 … 0.5). Viking: a steep gable. Japanese: a
 * hip roof whose flat ridge runs along local z; the slope flattens into the eave and the nearly
 * straight eave line lifts gently only close to each corner.
 */
export const nationRoofHeight = (profile: NationRoofProfile, x: number, z: number) => {
  if (profile === "viking") return -.475 + .975 * Math.pow(1 - Math.abs(x) * 2, .85);
  const across = Math.abs(x) * 2, along = japaneseEndSlope(profile, z);
  const slope = Math.max(across, along);
  // As on real pagodas: the eave line runs nearly straight and lifts gently only near each corner.
  const cornerSweep = profile === "japanese-pyramid"
    ? Math.pow(across * Math.abs(z) * 2, 6)
    : Math.pow(across, 4) * Math.pow(Math.abs(z) * 2, 8);
  return -.475 + .975 * (1 - slope) + .08 * Math.pow(slope, 4) + .12 * cornerSweep;
};

/**
 * Height of the rendered roof mesh (flat triangles between the grid vertices), not the analytic
 * curve: decorations placed with it sit on the tiles the player actually sees. Each grid cell
 * is split along the same diagonal as the geometry indexes it (see nationRoofMainDiagonal).
 */
export const nationRoofMeshHeight = (profile: NationRoofProfile, detailed: boolean, x: number, z: number, compact = false) => {
  const { across, along } = nationRoofGrid(profile, detailed, compact);
  const column = Math.min(across - 1, Math.max(0, Math.floor((x + .5) * across)));
  const row = Math.min(along - 1, Math.max(0, Math.floor((z + .5) * along)));
  const fx = (x + .5) * across - column, fz = (z + .5) * along - row;
  const vertex = (dx: number, dz: number) =>
    nationRoofHeight(profile, (column + dx) / across - .5, (row + dz) / along - .5);
  const [a, b, c, d] = [vertex(0, 0), vertex(1, 0), vertex(0, 1), vertex(1, 1)];
  const centerX = (column + .5) / across - .5, centerZ = (row + .5) / along - .5;
  if (nationRoofMainDiagonal(profile, centerX, centerZ))
    return fz >= fx ? a + fz * (c - a) + fx * (d - c) : a + fx * (b - a) + fz * (d - b);
  if (fx + fz <= 1) return a + fx * (b - a) + fz * (c - a);
  return d + (1 - fx) * (c - d) + (1 - fz) * (b - d);
};

const JAPANESE_SOFFIT = -.49;
/** Rim thickness and where (fraction of the half extent) the soffit starts rising into the eaves. */
const JAPANESE_RIM = .05;
export const JAPANESE_EAVE_START = .78;
const JAPANESE_EAVE_RISE = .45;

/**
 * Unit height of a Japanese roof's underside (its soffit): flat over the walls, rising into the
 * eaves so the rim keeps one thickness. Hanging decorations attach to it.
 */
export const japaneseSoffitHeight = (profile: NationRoofProfile, x: number, z: number) => {
  const edge = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) * 2 - JAPANESE_EAVE_START) / (1 - JAPANESE_EAVE_START);
  return Math.min(nationRoofHeight(profile, x, z) - JAPANESE_RIM, JAPANESE_SOFFIT + edge * JAPANESE_EAVE_RISE);
};
