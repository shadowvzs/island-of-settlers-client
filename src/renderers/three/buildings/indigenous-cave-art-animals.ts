import { artEllipse, artLine, artPath, artPolygon, artRing } from "./indigenous-cave-art-primitives";

/** Original front-facing pig: folded ears, cheek outline, snout, nostrils and almond eyes. */
export const indigenousPigHead = (x: number, y: number) => {
  const ears = artPolygon(x, y, [[-.33, -.34], [-.68, -.72], [-.76, -.19], [-.51, .02]]) ||
    artPolygon(x, y, [[.33, -.34], [.68, -.72], [.76, -.19], [.51, .02]]);
  const face = artEllipse(x, y, 0, -.04, .54, .67);
  if (!ears && !face) return false;
  const earFold = artPath(Math.abs(x), y, [[.43, -.29], [.63, -.52], [.64, -.22], [.53, -.08]], .025);
  const eyes = [-1, 1].some(side => artEllipse(x, y, side * .265, -.16, .073, .041));
  const cheek = [-1, 1].some(side => artPath(x * side, y, [[.39, .05], [.43, .23], [.35, .39]], .018));
  if (earFold || eyes || cheek) return false;
  const snout = artEllipse(x, y, 0, .28, .295, .20);
  const snoutRim = Math.abs(((x / .295) ** 2 + ((y - .28) / .20) ** 2) - 1) < .17;
  if (snoutRim) return false;
  if (snout && [-.105, .105].some(cx => artEllipse(x, y, cx, .27, .045, .071))) return false;
  return !artPath(x, y, [[-.19, .53], [0, .57], [.19, .53]], .018);
};

const feather = (x: number, y: number, rootX: number, rootY: number, tipX: number, tipY: number,
  width: number) => {
  const dx = tipX - rootX, dy = tipY - rootY, length = Math.hypot(dx, dy);
  const nx = -dy / length * width, ny = dx / length * width;
  return artPolygon(x, y, [[rootX - nx, rootY - ny], [rootX + nx, rootY + ny],
    [tipX + nx * .3, tipY + ny * .3], [tipX, tipY], [tipX - nx * .3, tipY - ny * .3]]);
};

/** Spread eagle with a hooked profile, layered flight feathers, tail and two talons. */
export const indigenousEagle = (x: number, y: number) => {
  let wing = false;
  for (const side of [-1, 1]) {
    const px = x * side;
    wing ||= artPolygon(px, y, [[.10, -.18], [.42, -.45], [.91, -.55], [.68, -.03], [.18, .16]]);
    for (let index = 0; index < 7; index++) {
      const t = index / 6;
      wing ||= feather(px, y, .25 + t * .36, -.24 - t * .15,
        .39 + t * .52, .27 - t * .58, .045);
    }
  }
  const torso = artEllipse(x, y, 0, .10, .17, .39);
  const head = artPolygon(x, y, [[-.11, -.18], [-.13, -.39], [-.04, -.55], [.13, -.54],
    [.23, -.43], [.13, -.40], [.10, -.26], [.12, -.12]]);
  const beak = artPolygon(x, y, [[.13, -.49], [.34, -.42], [.29, -.30], [.25, -.39], [.12, -.40]]);
  let tail = false;
  for (const side of [-1, 0, 1]) tail ||= feather(x, y, side * .045, .34, side * .12, .73, .05);
  let feet = false;
  for (const side of [-1, 1]) {
    const px = x * side;
    feet ||= artPath(px, y, [[.105, .31], [.16, .49], [.30, .50]], .026) ||
      artPath(px, y, [[.16, .47], [.24, .55], [.30, .55]], .021) ||
      artPath(px, y, [[.16, .47], [.12, .57], [.17, .59]], .021);
  }
  if (!(wing || torso || head || beak || tail || feet)) return false;
  if (artEllipse(x, y, .08, -.44, .025, .022)) return false;
  // Negative brush strokes separate the coverts from the long primary feather layer.
  if (Math.abs(x) > .23 && artLine(Math.abs(x), y, [.24, -.13], [.77, -.39], .014)) return false;
  return true;
};

/** A berry sprig above a recognisable earthenware drinking cup. */
export const indigenousBerryDrink = (x: number, y: number) => {
  const cup = artPolygon(x, y, [[.05, -.02], [.73, -.02], [.61, .62], [.19, .62]]);
  const foot = artLine(x, y, [.14, .68], [.67, .68], .035);
  const rim = artRing((x - .39) * 1.3, (y + .025) * 4, 0, 0, .44, .10);
  const handle = artRing(x, y, .77, .26, .16, .04);
  const branch = artPath(x, y, [[-.65, .52], [-.49, -.10], [-.23, -.61]], .031);
  const berries = [[-.62, -.34], [-.37, -.31], [-.51, -.08], [-.73, -.08], [-.32, -.07]]
    .some(([cx, cy]) => artEllipse(x, y, cx!, cy!, .105, .105));
  const leaf = artPolygon(x, y, [[-.36, -.46], [-.72, -.66], [-.72, -.48], [-.47, -.36]]);
  if (!(cup || foot || rim || handle || branch || berries || leaf)) return false;
  if (cup && artPath(x, y, [[.18, .11], [.60, .11]], .020)) return false;
  return true;
};
