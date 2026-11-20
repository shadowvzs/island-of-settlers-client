import { cross, normalize, type Vec2, type Vec3 } from "../props/mesh-builder";
import { add, scale, subtract } from "../props/tree-parts";
import { type AtlasRect,PALM_RECTS } from "./foliage-atlas";
import { PALM_CELL } from "./palm-atlas";
import type { Frond } from "./tree-model";

interface FrondVertex {
  /** Signed position across the blade (-1 .. 1; fan: 0 at the centre .. 1 at the rim). */
  across: number;
  /** 0 where the leaf blade starts .. 1 at its tip (fan: the rim). */
  along: number;
  normal: Vec3;
  position: Vec3;
  uv: Vec2;
}

/** A frond's leaf blade (without the petiole) of the island mesh (prop mesh, impostor bake). */
export interface FrondSurface {
  triangles: number[];
  vertices: FrondVertex[];
}


const NARROW_COLUMNS = [-1, 0, 1];
const ISLAND_COLUMNS = [-1, -0.45, 0, 0.45, 1];

/** Young spear-like fronds keep three columns on the island (they are narrow and stiff). */
const getColumns = (frond: Frond) =>
  frond.cell === PALM_CELL.young01 ? NARROW_COLUMNS : ISLAND_COLUMNS;

/** Rachis points carrying leaflets: every other one on the island, the tip always. */
export const getBladeRows = (frond: Frond) => {
  const last = frond.points.length - 1;
  const rows: number[] = [];
  for (let index = frond.leafletStart; index < last; index += 2) rows.push(index);
  rows.push(last);
  return rows;
};

/** Leaflet plane at a rachis point: across (turned by roll and twist) and its normal. */
const getBladeFrame = (frond: Frond, index: number, along: number) => {
  const last = frond.points.length - 1;
  const ahead = frond.points[Math.min(last, index + 1)]!;
  const behind = frond.points[Math.max(0, index - 1)]!;
  const tangent = normalize(subtract(ahead, behind));
  const flat = normalize(cross(tangent, [0, 1, 0]));
  const up = normalize(cross(flat, tangent));
  const roll = frond.roll + frond.twist * along * along;
  const side = normalize(add(scale(flat, Math.cos(roll)), scale(up, Math.sin(roll))));
  return { normal: normalize(cross(side, tangent)), side };
};

const toCellUv = (rect: AtlasRect, u: number, v: number): Vec2 => [
  rect.u0 + (rect.u1 - rect.u0) * u,
  rect.v0 + (rect.v1 - rect.v0) * v
];

/**
 * Pinnate blade: rows along the rachis, columns across the leaflets. The leaflets rise from the
 * rachis in a V (fold) and their tips hang (droop), so the cross-section is a curved gull wing,
 * never one flat card; the rachis stays the centre column (the texture's midrib line).
 */
const createPinnateSurface = (frond: Frond): FrondSurface => {
  const rect = PALM_RECTS[frond.cell]!;
  const rows = getBladeRows(frond);
  const columns = getColumns(frond);
  const vertices: FrondVertex[] = [];
  const span = rows[rows.length - 1]! - frond.leafletStart;
  for (const index of rows) {
    const along = (index - frond.leafletStart) / Math.max(1, span);
    const { normal, side } = getBladeFrame(frond, index, along);
    const width = frond.widths[index]!;
    for (const across of columns) {
      const lift =
        frond.fold * Math.abs(across) - frond.droop * (0.6 + along * 0.6) * across * across;
      const slope = frond.fold * Math.sign(across) - frond.droop * 2 * across;
      vertices.push({
        across,
        along,
        normal: normalize(subtract(normal, scale(side, slope * 0.8))),
        position: add(
          frond.points[index]!,
          add(scale(side, across * width), scale(normal, lift * width))
        ),
        uv: toCellUv(rect, along, (across + 1) / 2)
      });
    }
  }
  const triangles: number[] = [];
  const stride = columns.length;
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let column = 0; column < stride - 1; column += 1) {
      const a = row * stride + column;
      triangles.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  return { triangles, vertices };
};

/** Fan cell geometry (palm-atlas.ts paintFanCell): centre at the bottom middle, rim radius. */
const FAN_CELL = { centre: 3 / 256, edgeAngle: 0.06, radiusU: 250 / 512, radiusV: 250 / 256 };
const FAN_RINGS = [0.5, 1];
const FAN_SPOKES = 8;

const getFanUv = (rect: AtlasRect, radius: number, angle: number) =>
  toCellUv(
    rect,
    0.5 + Math.cos(angle) * radius * FAN_CELL.radiusU,
    1 - FAN_CELL.centre - Math.sin(angle) * radius * FAN_CELL.radiusV
  );

/** Fan axes at the stalk tip: forward continues the stalk, across is horizontal. */
const getFanFrame = (frond: Frond) => {
  const last = frond.points.length - 1;
  const forward = normalize(subtract(frond.points[last]!, frond.points[last - 1]!));
  const flat = cross(forward, [0, 1, 0]);
  const side = Math.hypot(...flat) < 1e-3 ? ([1, 0, 0] as Vec3) : normalize(flat);
  const normal = normalize(cross(side, forward));
  return { forward, normal: normal[1] < 0 ? scale(normal, -1) : normal, side };
};

/**
 * Fan leaf (costapalmate): a half disc of pleated segments around the stalk tip; the spokes
 * alternate up and down (folds) and the rim droops.
 */
const createFanSurface = (frond: Frond): FrondSurface => {
  const rect = PALM_RECTS[frond.cell]!;
  const centre = frond.points[frond.points.length - 1]!;
  const radius = frond.widths[frond.widths.length - 1]!;
  const { forward, normal, side } = getFanFrame(frond);
  const spokes = FAN_SPOKES;
  const vertices: FrondVertex[] = [
    { across: 0, along: 0, normal, position: centre, uv: getFanUv(rect, 0, Math.PI / 2) }
  ];
  for (const ring of FAN_RINGS) {
    for (let spoke = 0; spoke <= spokes; spoke += 1) {
      const angle = FAN_CELL.edgeAngle + (spoke / spokes) * (Math.PI - FAN_CELL.edgeAngle * 2);
      const pleat = (spoke % 2 === 0 ? 1 : -1) * frond.fold * ring;
      const lift = pleat - frond.droop * ring * ring;
      const direction = add(scale(side, Math.cos(angle)), scale(forward, Math.sin(angle)));
      vertices.push({
        across: ring,
        along: ring,
        normal: normalize(add(normal, scale(direction, frond.droop * ring))),
        position: add(centre, add(scale(direction, ring * radius), scale(normal, lift * radius))),
        uv: getFanUv(rect, ring, angle)
      });
    }
  }
  const triangles: number[] = [];
  const ring = spokes + 1;
  for (let spoke = 0; spoke < spokes; spoke += 1) triangles.push(0, 1 + spoke, 2 + spoke);
  for (let band = 0; band < FAN_RINGS.length - 1; band += 1) {
    for (let spoke = 0; spoke < spokes; spoke += 1) {
      const a = 1 + band * ring + spoke;
      triangles.push(a, a + ring, a + 1, a + 1, a + ring, a + ring + 1);
    }
  }
  return { triangles, vertices };
};

/** The leaf blade of a frond. */
export const createFrondSurface = (frond: Frond): FrondSurface =>
  frond.blade === "fan" ? createFanSurface(frond) : createPinnateSurface(frond);

/** Last point of the bare petiole (fan: the fan centre). */
export const getPetioleEnd = (frond: Frond) =>
  frond.blade === "fan" ? frond.points.length - 1 : frond.leafletStart;


