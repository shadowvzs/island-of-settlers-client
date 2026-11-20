import { artEllipse, artPath, artPolygon } from "./indigenous-cave-art-primitives";

/** Feathered shoulder contour, with tapered overlapping rows rather than a repeated badge border. */
const shoulderTone = (x: number, y: number): number | undefined => {
  const side = Math.abs(x);
  const shoulder = artPolygon(side, y, [[.28, .13], [.59, .17], [.77, .36], [.84, .65],
    [.72, .84], [.39, .90], [.13, .72], [.18, .38]]);
  const breast = artEllipse(x, y, 0, .48, .47, .43);
  if (!shoulder && !breast) return undefined;
  let tone = shoulder ? .28 : .61;
  for (let row = 0; row < 5; row++) {
    const centreY = .29 + row * .12, stagger = row % 2 * .065;
    for (let column = -3; column <= 3; column++) {
      const centreX = column * .14 + stagger;
      if (artEllipse(x, y, centreX, centreY, .075, .14)) {
        const edge = ((x - centreX) / .075) ** 2 + ((y - centreY) / .14) ** 2;
        tone = .37 + .35 * Math.max(0, 1 - edge);
        if (Math.abs(x - centreX) < .009 && y > centreY - .07) tone -= .22;
      }
    }
  }
  return tone;
};

/** Tonal original pigment portrait: shaped facial discs, hooked beak, brows and layered feathers.
 * Undefined means untouched textile; 0..1 selects only earth-brown pigments in the shared atlas. */
export const indigenousWatchfulOwlTone = (x: number, y: number): number | undefined => {
  const side = Math.abs(x), shoulder = shoulderTone(x, y);
  const outline = ((x / .64) ** 2 + ((y + .18) / .65) ** 2);
  const tuft = artPolygon(side, y, [[.28, -.62], [.47, -.84], [.60, -.94], [.56, -.69],
    [.66, -.78], [.59, -.53], [.61, -.39], [.45, -.43]]);
  if (outline > 1 && !tuft) return shoulder;
  let tone = .30 + .08 * Math.cos(x * 13 + y * 5);
  const featherAngle = Math.atan2(y + .18, x);
  const contour = 1 + .015 * Math.sin(featherAngle * 29);
  if (!tuft && outline > contour) return shoulder;
  if (outline > .85) tone = .15 + .08 * Math.sin(featherAngle * 36);
  if (tuft) {
    if (artPath(side, y, [[.42, -.52], [.50, -.70], [.57, -.88]], .015)) return .73;
    return .17 + .18 * (1 - side);
  }
  // Each disc tilts inward and narrows towards the beak; radial fine strokes follow its feather growth.
  const dx = side - .27, dy = y + .13;
  const u = dx * .97 - dy * .24, v = dx * .24 + dy * .97;
  const disc = (u / .30) ** 2 + (v / .43) ** 2;
  if (disc < 1) {
    const angle = Math.atan2(v / .43, u / .30), radial = Math.sqrt(disc);
    tone = .70 + .12 * (1 - radial) + Math.sin(angle * 37 + radial * 19) * .045;
    if (radial > .88) tone = .31 + Math.sin(angle * 41) * .09;
  }
  // Broad upper orbital feathers shade an almond eye, with an umber iris and a dark living pupil.
  const eyeX = side - .255, eyeY = y + .25 + eyeX * .16;
  const eye = (eyeX / .151) ** 2 + (eyeY / .094) ** 2;
  if (eye < 1) {
    if (artEllipse(side, y, .235, -.28, .016, .021)) return .96;
    const iris = (eyeX / .077) ** 2 + (eyeY / .079) ** 2;
    if (iris < .38) return .02;
    if (iris < 1) return .46 + .12 * Math.cos(Math.atan2(eyeY, eyeX) * 19);
    return .14;
  }
  if (artPath(side, y, [[.08, -.32], [.20, -.40], [.38, -.40], [.51, -.30]], .035)) return .10;
  if (artPath(side, y, [[.10, -.37], [.24, -.46], [.43, -.41], [.55, -.33]], .017)) return .75;
  // A narrow hooked bill emerges between the discs; its light ridge turns into the dark lower hook.
  if (artPolygon(x, y, [[-.055, -.16], [.042, -.18], [.087, -.015], [.042, .15],
    [-.014, .22], [-.034, .10], [-.074, .015]])) return x < -.007 && y < .09 ? .73 : .08;
  if (artPath(side, y, [[.10, .05], [.13, .18], [.24, .29], [.42, .30]], .014)) return .25;
  // Cheek coverts curve with the face, with staggered short dark shafts rather than geometric Vs.
  for (let index = 0; index < 7; index++) {
    const angle = .12 + index * .19, rootX = .13 + Math.sin(angle) * .36;
    const rootY = .11 + Math.cos(angle) * .30;
    if (artPath(side, y, [[rootX, rootY - .045], [rootX + .02, rootY],
      [rootX + .01, rootY + .042]], .009)) return .19;
  }
  return Math.max(0, Math.min(1, tone));
};

export const indigenousWatchfulOwl = (x: number, y: number): boolean =>
  indigenousWatchfulOwlTone(x, y) !== undefined;
