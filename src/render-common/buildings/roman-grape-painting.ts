import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "./building-recipe";
import type { AddPart } from "./roman-resource-workshops";

/** Berry centres (dx, dy, diameter): a tapered bunch with a shoulder wing on the right. */
const BUNCH_ROWS = [
  { count: 3, dy: .04 }, { count: 4, dy: .0166 }, { count: 3, dy: -.0068 }, { count: 2, dy: -.0302 },
  { count: 1, dy: -.0536 }
] as const;
const BUNCH_X = .012;
const BERRY_PITCH = .027;
const BERRY_SIZE = .025;
const WING_BERRIES: readonly Point3[] = [[BUNCH_X + .054, .04, .022], [BUNCH_X + .0675, .0166, .021]];
const GRAPE_BERRIES: readonly Point3[] = [
  ...BUNCH_ROWS.flatMap(({ count, dy }, row) => Array.from({ length: count }, (_, index): Point3 =>
    [BUNCH_X + (index - (count - 1) / 2) * BERRY_PITCH, dy, BERRY_SIZE - row * .0007])),
  ...WING_BERRIES
];
/** Deep, ripe and dusty purples alternate so the berries read as separate fruit. */
const BERRY_SKINS: readonly Point3[] = [[.42, .14, .58], [.35, .1, .5], [.48, .18, .64]];
const BERRY_SHADE: Point3 = [.09, .025, .13];
const BERRY_SHINE: Point3 = [.86, .78, .93];

const LEAF_CENTRE = [-.064, .02] as const;
/** Palmate vine leaf lobes: direction (radians from +x) and length; the petiole sinus faces right. */
const LEAF_LOBES = [[2.4, .054], [1.45, .044], [3.35, .044], [.6, .032], [4.2, .032]] as const;
const LEAF_KEYLINE: Point3 = [.05, .14, .035];
const LEAF_GREEN: Point3 = [.27, .52, .14];
const LEAF_LIGHT: Point3 = [.42, .66, .22];
const LEAF_VEIN: Point3 = [.14, .32, .07];
const STEM_KEYLINE: Point3 = [.1, .06, .025];
const STEM_BROWN: Point3 = [.48, .3, .13];

type Shape = BuildingPart["shape"];

/** Paints flat pigment shapes on a tablet face, each layer slightly in front of the last. */
const createTabletBrush = (part: AddPart, x: number, y: number, z: number) =>
  (dx: number, dy: number, width: number, height: number, color: Point3, layer: number, shape: Shape,
    angle = 0) => part("paint", [x + dx, y + dy, z + .026 + layer * .001], [width, height, .002], 3, shape,
    [0, 0, angle], color);

type TabletBrush = ReturnType<typeof createTabletBrush>;

const addVineLeaf = (brush: TabletBrush) => {
  const [leafX, leafY] = LEAF_CENTRE;
  for (const [layer, color, grow] of [[0, LEAF_KEYLINE, .007], [1, LEAF_GREEN, 0]] as const) {
    brush(leafX, leafY, .062 + grow, .056 + grow, color, layer, "paint-ellipse");
    for (const [direction, length] of LEAF_LOBES) {
      const reach = length / 2 + .004;
      brush(leafX + DMath.cos(direction) * reach, leafY + DMath.sin(direction) * reach, length * 1.05 + grow,
        length + grow, color, layer, "paint-triangle", direction - Math.PI / 2);
    }
  }
  // The sunlit upper half and the veins running from the petiole into every lobe.
  brush(leafX - .008, leafY + .01, .038, .03, LEAF_LIGHT, 2, "paint-ellipse");
  for (const [direction, length] of LEAF_LOBES) brush(leafX + DMath.cos(direction) * length * .45,
    leafY + DMath.sin(direction) * length * .45, .0035, length * .9, LEAF_VEIN, 3, "paint-stroke",
    direction - Math.PI / 2);
};

const addBunchStem = (brush: TabletBrush) => {
  for (const [layer, color, grow] of [[2, STEM_KEYLINE, .004], [3, STEM_BROWN, 0]] as const) {
    brush(BUNCH_X + .004, .06, .007 + grow, .024 + grow, color, layer, "paint-stroke", -.25);
    // Petiole joining the leaf to the cane above the bunch.
    brush(-.026, .046, .005 + grow, .058 + grow, color, layer, "paint-stroke", -1.03);
  }
};

const addBerries = (brush: TabletBrush, detailed: boolean) => {
  // Each layer is complete before the next, so outlines never cut across a neighbouring berry.
  for (const [dx, dy, size] of GRAPE_BERRIES)
    brush(dx + .0012, dy - .0012, size + .005, size + .005, BERRY_SHADE, 4, "paint-ellipse");
  GRAPE_BERRIES.forEach(([dx, dy, size], index) =>
    brush(dx - .001, dy + .001, size * .9, size * .9, BERRY_SKINS[index % BERRY_SKINS.length]!, 5, "paint-ellipse"));
  if (!detailed) return;
  for (const [dx, dy, size] of GRAPE_BERRIES)
    brush(dx - size * .22, dy + size * .22, size * .3, size * .26, BERRY_SHINE, 6, "paint-triangle", .8);
};

/**
 * Grape bunch pictogram of the Vineyard and Winery tablets (and their signpost icon): shaded
 * berries in a tapered cluster with a shoulder wing, a stem and a lobed vine leaf. Minimal keeps
 * the outlined berries and leaf but drops the berry highlights.
 */
export const addRomanGrapePainting = (part: AddPart, x: number, y: number, z: number, detailed: boolean) => {
  const brush = createTabletBrush(part, x, y, z);
  addVineLeaf(brush);
  addBunchStem(brush);
  addBerries(brush, detailed);
};
