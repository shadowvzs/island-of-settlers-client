import { hashTexel } from "../../../src/render-common/materials/tile-canvas";
import { type DesignPlacement, IDENTITY_PLACEMENT, paintElement, placeFrame, placePoint,
  type TilePainter } from "./foliage-canvas";
import { BAKED_ROSE_LEAF, type LeafStyle, roseLeafletElement, TINTED_ROSE_LEAF } from "./rose-leaf-art";
import { ovoidElement, petalElement, sepalElement, TINTED_PETAL } from "./rose-petal-art";
import { paintPrickle, paintStem, type Point, type StemStyle } from "./stem-art";

const BAKED_STALK: StemStyle = { base: [0.07, 0.17, 0.03], roughness: 0.5, tint: 0, translucency: 0.25 };
const BAKED_BRISTLE: StemStyle = { base: [0.22, 0.12, 0.04], roughness: 0.5, tint: 0, translucency: 0.1 };
const BAKED_HIP = { base: [0.08, 0.2, 0.035] as const, tint: 0 };

/** Bud design pivot (pedicel base) in tile UV. */
export const BUD_PIVOT: Point = [0.5, 0.04];

const placeCurve = (placement: DesignPlacement, curve: readonly [Point, Point, Point]) =>
  curve.map(point => placePoint(placement, point)) as unknown as readonly [Point, Point, Point];

const paintBudSepal = (painter: TilePainter, placement: DesignPlacement, angle: number, length: number,
  lobes: -1 | 0 | 1 | 2, salt: number) => paintElement(painter, sepalElement({
  frame: placeFrame(placement, { angle, length, mirror: angle < 0, origin: [0.5, 0.34] }),
  lobes, salt, style: BAKED_ROSE_LEAF
}));

/** Side view of a closed bud: glandular pedicel, hip, spreading and hugging sepals, furled petals. */
export const paintRoseBud = (painter: TilePainter, placement: DesignPlacement, salt: number) => {
  paintStem(painter, { curve: placeCurve(placement, [BUD_PIVOT, [0.51, 0.16], [0.5, 0.26]]),
    radius: [0.017 * placement.scale, 0.014 * placement.scale], salt, style: BAKED_STALK });
  for (let index = 0; index < 5; index += 1) {
    const side = index % 2 ? 1 : -1, at: Point = [0.5 + side * 0.013, 0.07 + index * 0.04];
    paintPrickle(painter, { angle: placement.angle + side * 1.9, length: 0.012 * placement.scale,
      origin: placePoint(placement, at), style: BAKED_BRISTLE });
  }
  paintBudSepal(painter, placement, -1.85, 0.25, 2, salt + 1);
  paintBudSepal(painter, placement, 1.8, 0.24, 1, salt + 2);
  const tip: Point = [0.5, 0.86];
  const petals = [{ origin: [0.5, 0.31], width: 0.31 }, { origin: [0.468, 0.315], width: 0.24 },
    { origin: [0.535, 0.32], width: 0.2 }, { origin: [0.49, 0.33], width: 0.13 }] as const;
  petals.forEach((petal, index) => paintElement(painter, ovoidElement({
    frame: placeFrame(placement, { angle: Math.atan2(tip[0] - petal.origin[0], tip[1] - petal.origin[1]),
      length: Math.hypot(tip[0] - petal.origin[0], tip[1] - petal.origin[1]), origin: petal.origin }),
    gloss: 0.08, salt: salt + 10 + index,
    style: { base: [0.8 - index * 0.02, 0.8 - index * 0.02, 0.8 - index * 0.02], tint: 1 }, width: petal.width
  })));
  paintElement(painter, ovoidElement({ frame: placeFrame(placement, { angle: 0, length: 0.15, origin: [0.5, 0.215] }),
    gloss: 0.25, salt: salt + 20, style: BAKED_HIP, width: 0.44 }));
  paintBudSepal(painter, placement, -0.36, 0.31, -1, salt + 3);
  paintBudSepal(painter, placement, 0.34, 0.33, 0, salt + 4);
  paintBudSepal(painter, placement, 0.04, 0.24, 0, salt + 5);
};

/** Five sepals seen from below the flower, two bearded, one half-bearded, two plain. */
export const paintRoseCalyx = (painter: TilePainter, salt: number, style: LeafStyle = TINTED_ROSE_LEAF) => {
  const lobes = [2, 0, 1, 2, 0] as const;
  lobes.forEach((lobe, index) => {
    const angle = index * Math.PI * 0.4 + 0.2 + (hashTexel(index, 1, salt) - 0.5) * 0.25;
    paintElement(painter, sepalElement({ frame: { angle, length: 0.4 + hashTexel(index, 2, salt) * 0.05,
      origin: [0.5, 0.5] }, lobes: lobe, salt: salt + index, style }));
  });
  paintElement(painter, ovoidElement({ frame: { angle: 0, length: 0.16, origin: [0.5, 0.42] }, gloss: 0.1,
    salt, style: { base: style.base, tint: style.tint }, width: 0.5 }));
};

interface PetalRing { count: number; cup: number; depth: number; length: number; offset: number; twist: number;
  width: number }

const OPEN_HEAD_RINGS: readonly PetalRing[] = [
  { count: 5, cup: 0.02, depth: 0.42, length: 0.44, offset: 0.31, twist: 0, width: 0.62 },
  { count: 5, cup: 0.035, depth: 0.5, length: 0.35, offset: 0.94, twist: 0.08, width: 0.6 },
  { count: 5, cup: 0.05, depth: 0.55, length: 0.25, offset: 0.5, twist: 0.2, width: 0.58 },
  { count: 6, cup: 0.06, depth: 0.6, length: 0.14, offset: 0.1, twist: 1.05, width: 0.62 }
];

/** Front view of an open double rose: four imbricate petal whorls closing into a cupped spiral centre. */
export const paintOpenRose = (painter: TilePainter, placement: DesignPlacement, salt: number) => {
  OPEN_HEAD_RINGS.forEach((ring, ringIndex) => {
    for (let index = 0; index < ring.count; index += 1) {
      const radial = ring.offset + index * Math.PI * 2 / ring.count + (hashTexel(index, ringIndex, salt) - 0.5) * 0.2;
      const shift = 0.02 + ringIndex * 0.006;
      const origin: Point = [0.5 + Math.sin(radial) * shift, 0.5 + Math.cos(radial) * shift];
      paintElement(painter, petalElement({ clawFade: 0.3, cup: ring.cup, depth: ring.depth,
        frame: placeFrame(placement, { angle: radial + ring.twist,
          length: ring.length * (0.92 + hashTexel(index, ringIndex + 5, salt) * 0.16), origin }),
        salt: salt + ringIndex * 10 + index, shadow: 0.42, style: TINTED_PETAL, width: ring.width }));
    }
  });
  paintElement(painter, ovoidElement({ frame: placeFrame(placement, { angle: 0.4, length: 0.07, origin: [0.49, 0.47] }),
    gloss: 0, salt, style: { base: [0.55, 0.55, 0.55], tint: 1 }, width: 0.5 }));
};

/** Minimal bloom-cluster card: three open heads and two buds on a branched peduncle with leaflets. */
export const paintRoseBloomCluster = (painter: TilePainter, salt: number) => {
  for (const side of [-1, 1]) {
    paintElement(painter, roseLeafletElement({ frame: { angle: side * 1.2, length: 0.22, mirror: side < 0,
      origin: [0.5, 0.24] }, salt: salt + side, style: BAKED_ROSE_LEAF, teeth: 18 }));
  }
  const heads = [{ at: [0.29, 0.62], radius: 0.2 }, { at: [0.71, 0.6], radius: 0.19 },
    { at: [0.5, 0.78], radius: 0.18 }];
  const buds = [{ angle: -0.7, at: [0.22, 0.32] }, { angle: 0.75, at: [0.78, 0.34] }];
  for (const target of [...heads.map(head => head.at), ...buds.map(bud => bud.at)]) {
    paintStem(painter, { curve: [[0.5, 0.03], [0.5, 0.3], target as unknown as Point], radius: [0.016, 0.009],
      salt, style: BAKED_STALK });
  }
  buds.forEach((bud, index) => paintRoseBud(painter, { angle: bud.angle, origin: bud.at as unknown as Point,
    pivot: BUD_PIVOT, scale: 0.36 }, salt + 40 + index));
  heads.forEach((head, index) => paintOpenRose(painter, { ...IDENTITY_PLACEMENT, angle: index * 0.7,
    origin: head.at as unknown as Point, scale: head.radius / 0.46 }, salt + 60 + index * 7));
};
