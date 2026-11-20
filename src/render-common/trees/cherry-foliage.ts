import { lerp3 } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import { paintLeaf, paintLeafShadow, paintStem, type Rgb } from "./foliage-strokes";
import { jitter, type Painter, paintPath, type Point, type Twig,twigPath } from "./spray-painter";

/**
 * Cherry blossom atlas cells (256 px): thin dark twigs carrying clusters of notched five-petal
 * flowers with stamens, deep pink buds and a few young bronze-green leaves. Original procedural strokes
 * (linear colour, like every atlas cell).
 */

/** Petal pinks at the edge, from deep to nearly white; the base of each petal is deeper. */
const PETALS: Rgb[] = [
  [0.86, 0.3, 0.45],
  [0.94, 0.46, 0.6],
  [0.98, 0.6, 0.72],
  [1, 0.78, 0.85]
];
const PETAL_BASE: Rgb = [0.72, 0.13, 0.27];
const EYE: Rgb = [0.55, 0.52, 0.18];
const FILAMENT: Rgb = [0.85, 0.32, 0.46];
const ANTHER: Rgb = [0.95, 0.72, 0.18];
const BUD: Rgb = [0.62, 0.08, 0.2];
const YOUNG_LEAF: Rgb = [0.16, 0.13, 0.04];
/** Cherry wood: darker and greyer than the oak twig. */
const CHERRY_TWIG: Rgb = [0.055, 0.04, 0.038];
const SHADOW = { offset: [-1.2, -2.6] as Point, strength: .35 };
/** Half-angle between the two lobes of a petal: the notch at a sakura petal's tip. */
const NOTCH = .13;


/** Light in cell space, as on the oak sprays: from the spray's tip side. */
const LIGHT: Point = [.45, .89];
const getFold = (angle: number) => .2 * (-Math.sin(angle) * LIGHT[0] + Math.cos(angle) * LIGHT[1]);

/**
 * One petal: two overlapping lobes leave a small notch at the tip; soft fold light, a faint rim
 * against the petals behind, a mid-pink band and a deep flush at the base, and three fine veins.
 */
const paintPetal = (painter: Painter, centre: Point, angle: number, length: number, width: number, pink: Rgb) => {
  const { random } = painter;
  const edge = jitter(pink, random, .1);
  for (const side of [-1, 1]) {
    const lobeAngle = angle + side * NOTCH;
    const lobe = { ...painter.next(), angle: lobeAngle, color: edge, fold: getFold(lobeAngle), length,
      rim: .12, roundness: .95, width: width * .62, x: centre[0], y: centre[1] };
    paintLeafShadow(painter.canvas, painter.area, lobe, SHADOW);
    paintLeaf(painter.canvas, painter.area, lobe);
  }
  paintLeaf(painter.canvas, painter.area, { ...painter.next(), angle, color: lerp3(edge, PETAL_BASE, .3),
    length: length * .66, roundness: .9, width: width * .66, x: centre[0], y: centre[1] });
  paintLeaf(painter.canvas, painter.area, { ...painter.next(), angle, color: lerp3(edge, PETAL_BASE, .65),
    length: length * .36, roundness: .9, width: width * .44, x: centre[0], y: centre[1] });
  for (const spread of [-.28, 0, .28]) {
    const veinAngle = angle + spread * .6, reach = length * (spread ? .72 : .82);
    paintStem(painter.canvas, painter.area, { ...painter.next(), color: lerp3(edge, PETAL_BASE, .4),
      from: [centre[0] + Math.cos(veinAngle) * length * .2, centre[1] + Math.sin(veinAngle) * length * .2],
      thickness: [.32, .18], to: [centre[0] + Math.cos(veinAngle) * reach, centre[1] + Math.sin(veinAngle) * reach] });
  }
};

/**
 * One flower: five notched petals, a green-gold eye and a ring of fine pink filaments tipped
 * with yellow anthers.
 */
const paintFlower = (painter: Painter, centre: Point, radius: number, light = 1) => {
  const { random } = painter;
  const base = PETALS[Math.floor(random() * PETALS.length)]!;
  const pink: Rgb = [base[0] * light, base[1] * light, base[2] * light];
  const turn = random() * Math.PI * 2;
  // Seen at an angle, a flower is an ellipse: alternate petals are foreshortened.
  const tilt = .65 + random() * .35;
  for (let petal = 0; petal < 5; petal++)
    paintPetal(painter, centre, turn + petal * Math.PI * 2 / 5, radius * (petal % 2 ? tilt : 1), radius * .9, pink);
  paintStem(painter.canvas, painter.area, { ...painter.next(), color: EYE, from: centre,
    thickness: [radius * .18, radius * .18], to: [centre[0] + .5, centre[1] + .5] });
  const filaments = 9 + Math.floor(random() * 4);
  for (let filament = 0; filament < filaments; filament++) {
    const angle = turn + filament * Math.PI * 2 / filaments + (random() - .5) * .3;
    const reach = radius * (.45 + random() * .15);
    const tip: Point = [centre[0] + Math.cos(angle) * reach, centre[1] + Math.sin(angle) * reach];
    paintStem(painter.canvas, painter.area, { ...painter.next(), color: FILAMENT, from: centre,
      thickness: [.55, .4], to: tip });
    paintStem(painter.canvas, painter.area, { ...painter.next(), color: ANTHER, from: tip,
      thickness: [1, 1], to: [tip[0] + .3, tip[1] + .3] });
  }
};

/** A closed bud: a deep pink oval on its stalk. */
const paintBud = (painter: Painter, from: Point, random: Random) => {
  const angle = random() * Math.PI * 2, stalk = 6 + random() * 6;
  const base: Point = [from[0] + Math.cos(angle) * stalk, from[1] + Math.sin(angle) * stalk];
  paintStem(painter.canvas, painter.area, { ...painter.next(), color: CHERRY_TWIG, from, thickness: [.7, .5],
    to: base });
  paintLeaf(painter.canvas, painter.area, { ...painter.next(), angle, color: jitter(BUD, random, .2),
    length: 7 + random() * 3, roundness: 1, width: 5 + random() * 2, x: base[0], y: base[1] });
};

/** A cluster of flowers on short stalks around a node of the twig; sometimes a young leaf. */
const paintCluster = (painter: Painter, twig: Twig, t: number, random: Random) => {
  const [x, y] = twig(t);
  const flowers = 3 + Math.floor(random() * 4);
  for (let flower = 0; flower < flowers; flower++) {
    const angle = random() * Math.PI * 2, reach = 8 + random() * 16;
    const centre: Point = [x + Math.cos(angle) * reach, y + Math.sin(angle) * reach];
    if (centre[0] < 20 || centre[1] < 20 || centre[0] > painter.area.width - 20 ||
      centre[1] > painter.area.height - 20) continue;
    paintStem(painter.canvas, painter.area, { ...painter.next(), color: CHERRY_TWIG, from: [x, y],
      thickness: [.9, .6], to: centre });
    // Flowers further back in the cluster are drawn first, smaller and in shade.
    const back = flower < flowers / 2;
    paintFlower(painter, centre, (back ? 10 : 13) + random() * 7, back ? .8 : 1);
  }
  if (random() < .45) paintBud(painter, [x, y], random);
  if (random() < .15) {
    const angle = random() * Math.PI * 2, length = 18 + random() * 10;
    paintLeaf(painter.canvas, painter.area, { ...painter.next(), angle, color: jitter(YOUNG_LEAF, random, .3),
      length, roundness: .5, width: length * .42, x, y });
  }
};

/** Blossom spray: a thin dark twig with two side twigs, crowded with flower clusters. */
export const paintCherrySpray = (painter: Painter) => {
  const { area, random } = painter;
  const main = twigPath([area.width / 2, 4], Math.PI / 2 + (random() - .5) * .3, area.height * .8,
    (random() - .5) * .6);
  const sides = [-1, 1].map(side => twigPath(main(.3 + random() * .2), Math.PI / 2 - side * (.7 + random() * .4),
    area.width * .38, side * .35));
  paintPath(painter, main, [2.6, 1], CHERRY_TWIG);
  for (const side of sides) paintPath(painter, side, [1.8, .7], CHERRY_TWIG);
  for (const twig of [main, ...sides])
    for (let t = .35; t <= 1; t += .2 + random() * .12) paintCluster(painter, twig, Math.min(1, t), random);
};
