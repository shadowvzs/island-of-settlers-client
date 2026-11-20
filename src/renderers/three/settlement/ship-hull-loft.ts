import { BufferGeometry, Float32BufferAttribute } from "three";

/** Hull length in ship space: rings run from z = -HULL_HALF_LENGTH (stern) to +HULL_HALF_LENGTH (bow). */
const HULL_HALF_LENGTH = 1.1;

/**
 * A hull form in ship space (before the sailing-ship scale), t 0 at the stern … 1 at the bow and a
 * section parameter a, 0 at the gunwale … 1 at the keel.
 */
export interface HullForm {
  /** Half beam at the gunwale. */
  beam: (t: number) => number;
  /** Gunwale height. */
  sheer: (t: number) => number;
  /** Depth from the gunwale to the keel on the centreline. */
  depth: (t: number) => number;
  /** Section shape: share of the beam outwards and of the depth downwards at `a`. */
  section: (a: number) => readonly [number, number];
  /** Optional forward shift of the surface at (t, a): a raked, curving stem instead of an upright bow end. */
  rake?: (t: number, a: number) => number;
  /**
   * Optional share (0…1) at `t` by which the section sharpens into a straight V towards the keel, so
   * a bow can close onto its stem as a cutwater instead of keeping a full bilge.
   */
  vee?: (t: number) => number;
}

export const hullZ = (t: number) => (t - .5) * 2 * HULL_HALF_LENGTH;

/** A point of the hull surface on one side (`side` -1 port, +1 starboard), pushed `out` along the beam. */
export const hullPoint = (form: HullForm, t: number, a: number, side: number, out = 0) => {
  const [full, down] = form.section(a), vee = form.vee?.(t) ?? 0;
  const across = full + (1 - Math.max(0, a) - full) * vee;
  const z = hullZ(t) + (form.rake?.(t, a) ?? 0);
  return [side * (form.beam(t) * across + out), form.sheer(t) - form.depth(t) * down, z] as const;
};

export interface BandOptions {
  /** Section range of the band (gunwale side first). */
  from: number; to: number;
  rings: number;
  /** Rows across the band. */
  rows: number;
  /** Clinker lap: the band's lower edge stands this far proud of the band below. */
  lap?: number;
  /** Lift of the band off the hull (a painted strake laid over the planking). */
  out?: number;
}

/**
 * Both sides of one band of planking (a strake, a painted stripe or the whole bottom), wound to face
 * outwards. UVs run along the hull (u) and across the band (v).
 */
export const hullBand = (form: HullForm, { from, lap = 0, out = 0, rings, rows, to }: BandOptions) => {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (const side of [-1, 1]) {
    const start = positions.length / 3;
    for (let ring = 0; ring < rings; ring++) for (let row = 0; row <= rows; row++) {
      const t = ring / (rings - 1), k = row / rows, a = from + (to - from) * k;
      positions.push(...hullPoint(form, t, a, side, out + lap * k));
      uvs.push(hullZ(t) * 2, k);
      if (ring === rings - 1 || row === rows) continue;
      const p = start + ring * (rows + 1) + row, next = p + rows + 1;
      if (side > 0) indices.push(p, next, p + 1, next, next + 1, p + 1);
      else indices.push(p, p + 1, next, next, p + 1, next + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};

/** Clinker planking: `strakes` overlapping bands between `from` and `to`, each lapped over the next. */
export const clinkerBands = (form: HullForm, strakes: number, options: Omit<BandOptions, "lap">, lap: number) =>
  Array.from({ length: strakes }, (_, index) => {
    const step = (options.to - options.from) / strakes;
    return hullBand(form, { ...options, from: options.from + step * index, lap,
      to: options.from + step * (index + 1.15) });
  });

/**
 * A flat panel closing a hull end (a transom) at `t`, from section `from` (the bulwark top when the
 * planking rises above the gunwale) to the keel, its face towards `facing` z.
 */
export const hullEndCap = (form: HullForm, t: number, rows: number, facing: 1 | -1, from = 0) => {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) for (const side of [-1, 1]) {
    const point = hullPoint(form, t, from + (1 - from) * row / rows, side);
    positions.push(...point); uvs.push(point[0], point[1]);
    if (row === rows || side < 0) continue;
    const a = row * 2, b = a + 2;
    if (facing < 0) indices.push(a, a + 1, b, b, a + 1, b + 1); else indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};

/** Where a line runs on the hull: section `a` (0 the gunwale), pushed `out` and raised `lift`. */
export interface HullLine { a?: number; lift?: number; out?: number }

/** Points along one side of the hull at a fixed section (rails, rubbing strakes, rows of fittings). */
export const gunwaleLine = (form: HullForm, side: number, rings: number, { a = 0, lift = 0, out = 0 }: HullLine = {}) =>
  Array.from({ length: rings }, (_, ring) => {
    const [x, y, z] = hullPoint(form, ring / (rings - 1), a, side, out);
    return [x, y + lift, z];
  });

/** Section values of a band's vertex rows, `from` to `to` in `rows` steps. */
export const bandSections = (from: number, to: number, rows: number) =>
  Array.from({ length: rows + 1 }, (_, row) => from + (to - from) * row / rows);

/**
 * Where the hull skin passes height `y` at `t` on its mesh: linear between the section vertex rows
 * `sections` (gunwale first), as the planking triangles run. Returns [z, half-beam].
 */
const skinAtHeight = (form: HullForm, t: number, y: number, sections: readonly number[]) => {
  let upper = hullPoint(form, t, sections[0]!, 1);
  if (upper[1] <= y) return [upper[2], upper[0]] as const;
  for (let row = 1; row < sections.length; row++) {
    const lower = hullPoint(form, t, sections[row]!, 1);
    if (lower[1] <= y) {
      const k = (upper[1] - y) / (upper[1] - lower[1]);
      return [upper[2] + (lower[2] - upper[2]) * k, upper[0] + (lower[0] - upper[0]) * k] as const;
    }
    upper = lower;
  }
  return [upper[2], upper[0]] as const;
};

/** Deck heights the outline must clear: the plank underside and top. */
export interface DeckLevels { bottom: number; top: number }

/** The end rings step `inset` inside the hull end caps; the others lie between both heights. */
const outlineZ = (ring: number, rings: number, lowerZ: number, upperZ: number, inset: number) => {
  if (ring === 0) return Math.max(lowerZ, upperZ) + inset;
  if (ring === rings - 1) return Math.min(lowerZ, upperZ) - inset;
  return (lowerZ + upperZ) / 2;
};

/**
 * The deck's plan outline inside the hull skin, one [z, half-beam] point per hull ring (stern first),
 * so the planks meet the planking without piercing it between rings. `sections` are the vertex rows
 * of the planking bands round the deck height; `inset` keeps a hair's clearance from the skin.
 */
export const hullDeckOutline = (form: HullForm, rings: number, sections: readonly number[],
  { bottom, top }: DeckLevels, inset = .002) => Array.from({ length: rings }, (_, ring) => {
  const t = ring / (rings - 1), lower = skinAtHeight(form, t, bottom, sections);
  const upper = skinAtHeight(form, t, top, sections);
  const halfBeam = Math.max(0, Math.min(lower[1], upper[1]) - inset);
  return [outlineZ(ring, rings, lower[0], upper[0], inset), halfBeam] as const;
});
