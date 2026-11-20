import { BufferGeometry, Float32BufferAttribute } from "three";

import {
  isJapaneseRoofProfile, JAPANESE_EAVE_START, japaneseEndSlope, japaneseRidgeHalf, japaneseSoffitHeight,
  nationRoofGrid, nationRoofHeight, nationRoofMainDiagonal, nationRoofMeshHeight, type NationRoofProfile
} from "../../../render-common/buildings/nation-roof-profile";
import { KAWARA_PITCHES_PER_TILE } from "./nation-roof-surface-detail";

/** Hongawara tiling (High): rounded cover-tile rolls down every slope, in recipe units. */
const TILE_PITCH = .27;
const ROLL_HALF_WIDTH = .036;
const ROLL_HEIGHT = .03;
const ROLL_SEGMENTS = 2;
const SOFFIT_START = JAPANESE_EAVE_START / 2;
const SOFFIT_LINES = [-.5, -.45, -SOFFIT_START, SOFFIT_START, .45, .5];
/** Exposed rafters under the eaves (High): spacing, width and depth below the soffit. */
const RAFTER_PITCH = .2;
const RAFTER_HALF_WIDTH = .018;
const RAFTER_DEPTH = .03;

type Buffers = { indices: number[]; positions: number[]; uvs: number[] };
type RoofUv = (x: number, z: number) => [number, number];

/** Cover-tile rolls on the long slopes (spaced along z) and on the hip ends (spaced along x). */
const japaneseRollCounts = (size: readonly number[]) => ({
  end: Math.max(2, Math.round(size[0]! / TILE_PITCH)), long: Math.max(3, Math.round(size[2]! / TILE_PITCH))
});

/**
 * Kawara map in roll pitches: u counts courses down the slope, v the pans between the rolls. The
 * long slopes fall along x, the hip ends along z, so each face gets its own map and on every face
 * the courses run parallel to the eave while the pan channels run downslope.
 */
const japaneseRoofUv = (size: readonly number[]) => {
  const rolls = japaneseRollCounts(size);
  const pitches = (value: number, count: number) => (value + .5) * count / KAWARA_PITCHES_PER_TILE;
  const long: RoofUv = (x, z) => [pitches(x, rolls.end), pitches(z, rolls.long)];
  const end: RoofUv = (x, z) => [pitches(z, rolls.long), pitches(x, rolls.end)];
  return { end, long };
};

/** Hip-end faces of the Japanese roof: where the slope falls along z (see nationRoofHeight). */
const isJapaneseHipEnd = (profile: NationRoofProfile, x: number, z: number) =>
  japaneseEndSlope(profile, z) > Math.abs(x) * 2;

const unitRoofUv: RoofUv = (x, z) => [x + .5, z + .5];

/**
 * One cover-tile roll from `start` to the eave along the slope axis (0: x, 2: z), lying on the
 * rendered roof triangles; a peaked cross-section with shared crest vertices shades round, and
 * its end at the eave shows the round tile end (see addRollEnd).
 */
const addRoll = (
  buffers: Buffers, height: (x: number, z: number) => number, uv: RoofUv, axis: 0 | 2, fixed: number, start: number,
  end: number, halfWidth: number, rise: number
) => {
  const base = buffers.positions.length / 3;
  for (let step = 0; step <= ROLL_SEGMENTS; step++) {
    const along = start + (end - start) * step / ROLL_SEGMENTS;
    for (const side of [-1, 0, 1]) {
      const across = fixed + side * halfWidth;
      const [x, z] = axis === 0 ? [along, across] : [across, along];
      buffers.positions.push(x, height(x, z) + .004 + (side ? 0 : rise), z);
      buffers.uvs.push(...uv(x, z));
    }
  }
  for (let step = 0; step < ROLL_SEGMENTS; step++) {
    const a = base + step * 3, b = a + 3;
    const flip = (axis === 0) === (end > start);
    for (const [left, right] of [[0, 1], [1, 2]] as const) {
      if (flip) buffers.indices.push(a + left, b + left, a + right, a + right, b + left, b + right);
      else buffers.indices.push(a + left, a + right, b + left, a + right, b + right, b + left);
    }
  }
  addRollEnd(buffers, base + ROLL_SEGMENTS * 3, (axis === 0) === (end > start));
};

/**
 * The roll's round end at the eave: one outward-facing triangle on its own vertices, so it gets
 * its own (outward) normal. Sharing the roll's vertices with a two-sided cap cancelled the normals
 * and drew every end black.
 */
const addRollEnd = (buffers: Buffers, last: number, outwardOrder: boolean) => {
  const cap = buffers.positions.length / 3;
  for (let corner = 0; corner < 3; corner++) {
    buffers.positions.push(...buffers.positions.slice((last + corner) * 3, (last + corner) * 3 + 3));
    buffers.uvs.push(...buffers.uvs.slice((last + corner) * 2, (last + corner) * 2 + 2));
  }
  if (outwardOrder) buffers.indices.push(cap, cap + 1, cap + 2);
  else buffers.indices.push(cap + 2, cap + 1, cap);
};

/** Cover-tile rolls on all four slopes of the Japanese hip roof; size keeps them to scale. */
const addJapaneseTiles = (buffers: Buffers, size: readonly number[], profile: NationRoofProfile) => {
  const height = (x: number, z: number) => nationRoofMeshHeight(profile, true, x, z);
  const ridgeHalf = japaneseRidgeHalf(profile);
  const [width, , length] = size as [number, number, number];
  const rise = ROLL_HEIGHT / Math.max(.05, size[1]!), { end: endUv, long: longUv } = japaneseRoofUv(size);
  const { end: endRolls, long: longRolls } = japaneseRollCounts(size);
  // Long slopes fall along x; the hip line is where the end slopes take over (|z| = |x|/2 + .25
  // on a hip roof, |z| = |x| on a pyramid).
  for (let roll = 0; roll < longRolls; roll++) {
    const z = (roll + .5) / longRolls - .5, ridge = japaneseEndSlope(profile, z) / 2;
    if (.5 - ridge < 1.5 / longRolls) continue;
    for (const side of [-1, 1]) addRoll(buffers, height, longUv, 0, z, side * ridge, side * .5,
      ROLL_HALF_WIDTH / length, rise);
  }
  for (let roll = 0; roll < endRolls; roll++) {
    const x = (roll + .5) / endRolls - .5, hip = ridgeHalf + Math.abs(x) * (1 - ridgeHalf * 2);
    if (.5 - hip < 1 / endRolls) continue;
    for (const side of [-1, 1]) addRoll(buffers, height, endUv, 2, x, side * hip, side * .5,
      ROLL_HALF_WIDTH / width, rise);
  }
};

/** One rafter under the eave at `fixed` along `axis`, a downward-facing U strip below the soffit. */
const addRafter = (
  buffers: Buffers, underside: (x: number, z: number) => number, axis: 0 | 2, fixed: number, start: number,
  end: number, halfWidth: number, depth: number
) => {
  const base = buffers.positions.length / 3, steps = 1;
  for (let step = 0; step <= steps; step++) {
    const along = start + (end - start) * step / steps;
    for (const [side, drop] of [[-1, 0], [-1, 1], [1, 1], [1, 0]] as const) {
      const across = fixed + side * halfWidth;
      const [x, z] = axis === 0 ? [along, across] : [across, along];
      buffers.positions.push(x, underside(x, z) - .004 - drop * depth, z);
      buffers.uvs.push(x + .5, z + .5);
    }
  }
  for (let step = 0; step < steps; step++) for (let face = 0; face < 3; face++) {
    const a = base + step * 4 + face, b = a + 4;
    const flip = (axis === 0) !== (end > start);
    if (flip) buffers.indices.push(a, b, a + 1, a + 1, b, b + 1);
    else buffers.indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
};

/** Rafters on all four sides of the eave zone, each side's own rafters up to the hip diagonal. */
const addJapaneseRafters = (buffers: Buffers, underside: (x: number, z: number) => number, size: readonly number[]) => {
  const [width, , length] = size as [number, number, number];
  const start = SOFFIT_START, depth = RAFTER_DEPTH / Math.max(.05, size[1]!);
  const rafters = (axis: 0 | 2, span: number, other: number) => {
    const count = Math.max(4, Math.round(span / RAFTER_PITCH));
    for (let index = 0; index < count; index++) {
      const fixed = (index + .5) / count - .5;
      // Past the wall line, each side's rafters stop where the hip crosses to the next side.
      const from = Math.max(start, Math.abs(fixed) * other / span);
      if (from >= .48) continue;
      for (const side of [-1, 1]) addRafter(buffers, underside, axis, fixed, side * from, side * .5,
        RAFTER_HALF_WIDTH / span, depth);
    }
  };
  rafters(0, length, width);
  rafters(2, width, length);
};

/** Continuous thick curved roof, with closed gable/hip edges and no flat Roman roof underneath. */
export const createNationRoofGeometry = (
  profile: NationRoofProfile, detailed: boolean, size: readonly number[] = [1, 1, 1],
  layer?: "soffit" | "rafters", compact = false
) => {
  const { across, along } = nationRoofGrid(profile, detailed, compact);
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const height = (x: number, z: number) => nationRoofHeight(profile, x, z);
  // A Japanese roof is a solid body: over the walls its soffit stays flat at the wall line, so
  // nothing shows through; toward the eaves it rises with the roof, leaving one even rim
  // thickness all round instead of a fascia that thickens at the swept corners.
  const underside = (x: number, z: number) =>
    isJapaneseRoofProfile(profile) ? japaneseSoffitHeight(profile, x, z) : height(x, z) - .025;
  const japanese = isJapaneseRoofProfile(profile);
  if (japanese && layer) return createJapaneseUnderside(detailed, size, layer, underside);
  const layerSize = (across + 1) * (along + 1);
  const uv = japanese ? japaneseRoofUv(size) : { end: unitRoofUv, long: unitRoofUv };
  // Layers: 0 the top (long-slope map), 1 the underside, 2 the top again with the hip-end map.
  const layers = japanese ? [0, 1, 2] : [0, 1];
  for (const layer of layers) for (let row = 0; row <= along; row++) for (let column = 0; column <= across; column++) {
    const x = column / across - .5, z = row / along - .5;
    positions.push(x, layer === 1 ? underside(x, z) : height(x, z), z);
    uvs.push(...(layer === 2 ? uv.end : uv.long)(x, z));
  }
  const hipEndLayer = 2 * layerSize;
  // Each top triangle lies wholly on one face (the hips run along cell diagonals); hip-end
  // triangles use their own vertices, so their tile courses turn with the eave and the hip folds crisply.
  const gridX = (index: number) => (index % (across + 1)) / across - .5;
  const gridZ = (index: number) => Math.floor(index / (across + 1)) / along - .5;
  const topTriangle = (a: number, b: number, c: number) => {
    const centreX = (gridX(a) + gridX(b) + gridX(c)) / 3, centreZ = (gridZ(a) + gridZ(b) + gridZ(c)) / 3;
    const hipEnd = japanese && isJapaneseHipEnd(profile, centreX, centreZ);
    const offset = hipEnd ? hipEndLayer : 0;
    indices.push(a + offset, b + offset, c + offset);
  };
  const quad = (a: number, b: number, c: number, d: number, main = false) =>
    main ? indices.push(a, c, d, a, d, b) : indices.push(a, c, b, b, c, d);
  for (let row = 0; row < along; row++) for (let column = 0; column < across; column++) {
    const a = row * (across + 1) + column, b = a + 1, c = a + across + 1, d = c + 1;
    const main = nationRoofMainDiagonal(profile, (column + .5) / across - .5, (row + .5) / along - .5);
    if (main) { topTriangle(a, c, d); topTriangle(a, d, b); }
    else { topTriangle(a, c, b); topTriangle(b, c, d); }
    // A Japanese roof's underside is its own soffit part (boards and rafters, not tiles).
    if (!japanese) quad(a + layerSize, c + layerSize, b + layerSize, d + layerSize, main);
  }
  for (let row = 0; row < along; row++) {
    const a = row * (across + 1), b = a + across + 1;
    quad(a, b, a + layerSize, b + layerSize);
    quad(a + across, a + across + layerSize, b + across, b + across + layerSize);
  }
  // The hip-end rims take the hip-end map, like the tiles above them.
  const endRim = japanese ? hipEndLayer : 0;
  for (let column = 0; column < across; column++) {
    quad(column + endRim, column + layerSize, column + 1 + endRim, column + 1 + layerSize);
    const a = along * (across + 1) + column;
    quad(a + endRim, a + 1 + endRim, a + layerSize, a + 1 + layerSize);
  }
  if (japanese && detailed) addJapaneseTiles({ indices, positions, uvs }, size, profile);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};

/** Soffit board (the roof's underside, facing down) or its rafters, as separate parts. */
const createJapaneseUnderside = (
  detailed: boolean, size: readonly number[], layer: "soffit" | "rafters",
  underside: (x: number, z: number) => number
) => {
  const buffers: Buffers = { indices: [], positions: [], uvs: [] };
  if (layer === "rafters") addJapaneseRafters(buffers, underside, size);
  else {
    // Flat under the walls: lines only where the soffit starts rising and towards the eave.
    const lines = detailed ? SOFFIT_LINES : [-.5, -SOFFIT_START, SOFFIT_START, .5];
    for (const z of lines) for (const x of lines) {
      buffers.positions.push(x, underside(x, z), z);
      // Boards run across the eave: stretch the texture along it.
      buffers.uvs.push((x + .5) * 4, (z + .5) * 4);
    }
    const side = lines.length;
    for (let row = 0; row < side - 1; row++) for (let column = 0; column < side - 1; column++) {
      const a = row * side + column, b = a + 1, c = a + side, d = c + 1;
      buffers.indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(buffers.uvs, 2));
  geometry.setIndex(buffers.indices); geometry.computeVertexNormals();
  // The board faces outward and a little down, so it catches the side light like a real eave
  // band instead of only the (green) ground bounce under it.
  if (layer === "soffit") {
    const normals = geometry.getAttribute("normal"), points = geometry.getAttribute("position");
    for (let index = 0; index < normals.count; index++) {
      const x = points.getX(index), z = points.getZ(index), length = Math.hypot(x, -.35, z) || 1;
      normals.setXYZ(index, x / length, -.35 / length, z / length);
    }
  }
  return geometry;
};
