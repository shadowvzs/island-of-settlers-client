import { anatomySurface, type SculptureAnatomy } from "./sculpture-anatomy";
import {
  carvedSculptureFeather, curveThrough, ellipsoid, loftGeometry, profileTube,
  type SculpturePoint, type sculptureRecipeBuilder,
} from "./sculpture-recipe";

type Add = ReturnType<typeof sculptureRecipeBuilder>["add"];
const tube = (add: Add, detailed: boolean, name: string, points: readonly SculpturePoint[], start: number,
  end: number, material: "jade" | "gold" | "dark" = "gold") => add(name, material,
  profileTube(curveThrough(points), t => start + (end - start) * t, detailed ? 12 : 4,
    detailed ? 9 : 4));

/** Tapered horns, flared nostrils, fleshy brows and long sensory whiskers on a proper dragon muzzle. */
export const addQilinHeadDetail = (add: Add, detailed: boolean, body: SculptureAnatomy) => {
  const front = (x: number, y: number, offset = .003): SculpturePoint =>
    [x, y, anatomySurface(body, [x, y, 0], 2) + offset];
  for (const side of [-1, 1]) {
    add("qilin_nostril", "dark", ellipsoid(detailed ? 14 : 6,
      [.009, .005, .003], front(side * .026, .928, .001), -.22));
    tube(add, detailed, "qilin_nasal_rim", [front(side * .017, .933),
      front(side * .026, .936), front(side * .036, .929)], .003, .0015, "jade");
    add("qilin_eye_socket", "dark", ellipsoid(detailed ? 16 : 7,
      [.009, .006, .002], front(side * .046, .989, -.001)));
    add("qilin_amber_iris", "gold", ellipsoid(detailed ? 12 : 6,
      [.005, .004, .0015], front(side * .046, .989, .001)));
    add("qilin_pupil", "dark", ellipsoid(detailed ? 10 : 5,
      [.002, .003, .001], front(side * .046, .989, .002)));
    tube(add, detailed, "qilin_sculpted_brow", [front(side * .030, 1.003, -.003),
      front(side * .046, 1.004, -.002), front(side * .061, .994, -.003)], .009, .004, "jade");
    const cheek: SculpturePoint[] = [[.961, .49], [.935, .49], [.912, .455]].map(([y, z]) =>
      [side * (anatomySurface(body, [0, y!, z!], 0) - .003), y!, z!]);
    tube(add, detailed, "qilin_cheek_scroll", cheek, .009, .003, "jade");
    tube(add, detailed, "qilin_ear", [[side * .075, 1.017, .394], [side * .133, 1.088, .355],
      [side * .162, 1.116, .301]], .029, .003, "jade");
    if (detailed) tube(add, true, "qilin_ear_inner", [[side * .105, 1.055, .367],
      [side * .133, 1.087, .343], [side * .15, 1.105, .318]], .009, .001);
    tube(add, detailed, "qilin_whisker", [[side * .043, .923, .675],
      [side * .15, .94, .685], [side * .225, .989, .622], [side * .211, 1.025, .566]],
    .0075, .0008);
  }
  tube(add, detailed, "qilin_mouth", [front(-.038, .890), front(0, .891), front(.038, .890)],
    .0025, .0025, "dark");
  tube(add, detailed, "qilin_single_horn", [[0, 1.035, .432], [0, 1.13, .402],
    [.01, 1.22, .33], [.025, 1.255, .27]], .026, .001);
  if (detailed) for (const side of [-1, 1])
    tube(add, true, "qilin_horn_branch", [[0, 1.128, .401], [side * .055, 1.18, .376],
      [side * .087, 1.228, .329]], .012, .001);
};

/** Flowing three-dimensional locks, attached across the crest and cheeks instead of flat leaf plates. */
export const addQilinMane = (add: Add, detailed: boolean) => {
  for (const side of [-1, 1]) {
    const locks = detailed ? 13 : 4;
    for (let index = 0; index < locks; index++) {
      const t = index / (locks - 1), y = .99 - t * .31, z = .36 - t * .15;
      const x = side * (.065 + Math.sin(t * Math.PI) * .028);
      const wave = Math.sin(index * 2.7) * .018;
      const points: SculpturePoint[] = [[x, y, z], [x + side * .042, y + .02 + wave, z - .07],
        [x + side * (.067 + wave), y - .02, z - .14],
        [x + side * (.086 - wave), y - .09 - wave, z - .145]];
      add("qilin_flowing_mane", "gold", profileTube(curveThrough(points),
        phase => .020 * Math.sin(phase * Math.PI * .85 + .35) * (1 - phase) + .001,
        detailed ? 14 : 4, detailed ? 8 : 4));
    }
    for (let lock = 0; lock < (detailed ? 4 : 2); lock++) {
      const points: SculpturePoint[] = [[side * .06, .916, .485],
        [side * (.12 + lock * .012), .884, .438], [side * (.13 + lock * .018), .80 - lock * .017, .39]];
      tube(add, detailed, "qilin_cheek_mane", points, .01, .001);
    }
  }
  for (let lock = 0; lock < (detailed ? 9 : 3); lock++) {
    const x = (lock / (detailed ? 8 : 2) - .5) * .09;
    tube(add, detailed, "qilin_flowing_beard", [[x, .883, .58], [x * 1.3, .82, .586],
      [x * 1.5, .745, .53], [x * .9, .72, .475]], .01, .001);
  }
};

export const addQilinScales = (add: Add, detailed: boolean, body: SculptureAnatomy) => {
  const rows = detailed ? 5 : 2, columns = detailed ? 9 : 4;
  for (const side of [-1, 1]) for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const y = .41 + row * .048 * (detailed ? 1 : 2.5);
      const z = -.31 + column * .075 * (detailed ? 1 : 2) + row % 2 * .032;
      const x = anatomySurface(body, [0, y, z], 0);
      if (x < .075) continue;
      const plate = carvedSculptureFeather([[0, .031, -.005], [0, 0, .009],
        [0, -.034, .003]], detailed ? .026 : .036, detailed, true);
      plate.rotateY(side * Math.PI / 2).translate(side * (x + .004), y, z);
      add("qilin_flank_scale", "jade", plate);
    }
};

/** Split cloven hoof shells with a distinct coronet flare, all four feet on the shared mount plane. */
export const addQilinHooves = (add: Add, detailed: boolean) => {
  for (const side of [-1, 1]) for (const front of [false, true]) for (const cleft of [-1, 1]) {
    const hoof = loftGeometry([{ y: 0, rx: .021, rz: .046 }, { y: .013, rx: .023, rz: .047 },
      { y: .043, rx: .023, rz: .042 }, { y: .068, rx: .017, rz: .033 }], detailed ? 16 : 6);
    hoof.translate(side * .12 + cleft * .025, 0, front ? .285 : -.265);
    add("qilin_cloven_hoof", "gold", hoof);
  }
};
