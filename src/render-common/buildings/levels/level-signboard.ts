import type { Point3 } from "../building-recipe";
import { boxOf, doorFront, isFree, type LevelKit } from "./level-kit";

/** Arm and board, measured out from the wall face: clear of the door lane and the leaf's sweep. */
const SIGN = { arm: .32, boardHeight: .18, boardWidth: .28, rise: .28, sideGap: .3 } as const;
const INK: Point3 = [.12, .1, .09];

interface SignSpot { face: number; x: number; y: number }

/** The first side of the door where a sign and its arm touch nothing projecting from the wall. */
const findSignSpot = (kit: LevelKit): SignSpot | null => {
  const front = doorFront(kit.site);
  if (!front) return null;
  const { face } = front, { door } = kit.site;
  // Under the wall top (a gable may not stand above it), never below the door head.
  const y = Math.max(door.top + .05, Math.min(door.top + SIGN.rise, front.top - .05));
  for (const x of [door.right + SIGN.sideGap, door.left - SIGN.sideGap]) {
    if (x < front.minX + .1 || x > front.maxX - .1) continue;
    const box = boxOf([x, y - SIGN.boardHeight / 2, face + SIGN.arm / 2], [SIGN.boardWidth, SIGN.boardHeight + .1, SIGN.arm]);
    if (isFree(kit.site, box, .02, bounds => bounds.max[2] <= face + .012)) return { face, x, y };
  }
  return null;
};

/** Painted trade mark on both faces of a hanging board. */
const paintBoard = (kit: LevelKit, centre: Point3, thickness: number, pigment: Point3) => {
  for (const side of [-1, 1]) kit.add({ position: [centre[0], centre[1], centre[2] + side * (thickness / 2 + .002)],
    rotation: side < 0 ? [0, Math.PI, 0] : undefined, shape: "paint-ellipse", size: [.12, .1, .001], surface: "paint",
    tint: pigment });
};

const hangingBoard = (kit: LevelKit, spot: SignSpot, pigment: Point3, timber: boolean) => {
  const { face, x, y } = spot, out = SIGN.arm * .62;
  kit.add({ position: [x, y, face + SIGN.arm / 2 - .01], shape: timber ? "bevel-box" : "box",
    size: timber ? [.045, .045, SIGN.arm] : [.022, .022, SIGN.arm], surface: timber ? "wood" : "iron" });
  // Short hangers from the arm to the board's top corners.
  for (const side of [-1, 1]) kit.add({ position: [x + side * .09, y - .055, face + out], shape: "box",
    size: [.012, .09, .012], surface: "iron" });
  const board: Point3 = [x, y - .1 - SIGN.boardHeight / 2 + .01, face + out];
  kit.add({ position: board, shape: "bevel-box", size: [SIGN.boardWidth, SIGN.boardHeight, .03], surface: "wood" });
  paintBoard(kit, board, .03, pigment);
  if (kit.detailed && !timber) kit.add({ position: [x, y - .06, face + .1], rotation: [Math.PI / 4, 0, 0],
    shape: "box", size: [.016, .016, .2], surface: "iron" });
};

/** Japanese kanban: a tall narrow board under a wooden arm, an ink stroke over the trade colour. */
const kanban = (kit: LevelKit, spot: SignSpot, pigment: Point3) => {
  const { face, x, y } = spot, out = SIGN.arm * .62, height = .3;
  kit.add({ position: [x, y, face + SIGN.arm / 2 - .01], shape: "bevel-box", size: [.045, .045, SIGN.arm],
    surface: "wood" });
  for (const side of [-1, 1]) kit.add({ position: [x + side * .045, y - .05, face + out], shape: "box",
    size: [.01, .08, .01], surface: "iron" });
  const board: Point3 = [x, y - .09 - height / 2, face + out];
  kit.add({ position: board, shape: "bevel-box", size: [.14, height, .028], surface: "wood" });
  for (const side of [-1, 1]) {
    const z = board[2] + side * .016;
    kit.add({ position: [x, board[1] + .06, z], shape: "box", size: [.035, .13, .002], surface: "paint", tint: INK });
    kit.add({ position: [x, board[1] - .09, z], shape: "box", size: [.08, .05, .002], surface: "paint", tint: pigment });
  }
};

/** Nubian: a lime-washed roundel set flat in the wall beside the door, painted in the trade colour. */
const roundel = (kit: LevelKit, spot: SignSpot, pigment: Point3) => {
  const { face, x, y } = spot, centre: Point3 = [x, y - .06, face + .012];
  kit.add({ position: centre, rotation: [Math.PI / 2, 0, 0], shape: "cylinder", size: [.27, .03, .27],
    surface: "paint", tint: [.9, .86, .76], radialSegments: kit.detailed ? 16 : 8 });
  kit.add({ position: [x, centre[1], face + .029], shape: "paint-ellipse", size: [.17, .17, .001], surface: "paint",
    tint: pigment });
  if (kit.detailed) kit.add({ position: [x, centre[1], face + .03], shape: "paint-ellipse", size: [.07, .07, .001],
    surface: "paint", tint: [.2, .42, .62] });
};

/** Level 2 trade sign beside the door, in the nation's own form. */
export const addSignboard = (kit: LevelKit, pigment: Point3) => {
  const spot = findSignSpot(kit);
  if (!spot) return;
  if (kit.site.nation === "japanese") kanban(kit, spot, pigment);
  else if (kit.site.nation === "nubian") roundel(kit, spot, pigment);
  else hangingBoard(kit, spot, pigment, kit.site.nation === "viking");
};
