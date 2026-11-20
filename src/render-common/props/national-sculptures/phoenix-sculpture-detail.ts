import { anatomySurface, type SculptureAnatomy, sculptureAnatomyDistance } from "./sculpture-anatomy";
import {
  carvedSculptureFeather, curveThrough, ellipsoid, profileTube,
  type SculpturePoint, type sculptureRecipeBuilder,
} from "./sculpture-recipe";

type Add = ReturnType<typeof sculptureRecipeBuilder>["add"];
const tube = (add: Add, detailed: boolean, name: string, points: readonly SculpturePoint[], start: number,
  end: number, material: "gold" | "dark" | "phoenixCopper" = "gold") => add(name, material,
  profileTube(curveThrough(points), t => start + (end - start) * t,
    detailed ? 16 : 5, detailed ? 10 : 5));

export const addPhoenixHead = (add: Add, detailed: boolean) => {
  tube(add, detailed, "phoenix_hooked_beak", [[0, .789, .260], [0, .785, .313],
    [0, .762, .345], [0, .737, .333]], .022, .0015, "dark");
  tube(add, detailed, "phoenix_lower_beak", [[0, .747, .264], [0, .746, .309],
    [0, .754, .329]], .012, .001, "dark");
  for (const side of [-1, 1]) {
    add("phoenix_cere", "phoenixCopper", ellipsoid(detailed ? 16 : 7, [.023, .015, .029],
      [side * .013, .778, .252]));
    add("phoenix_nostril", "dark", ellipsoid(detailed ? 10 : 5, [.004, .005, .008],
      [side * .029, .783, .269]));
    add("phoenix_eye_socket", "dark", ellipsoid(detailed ? 16 : 7, [.012, .017, .019],
      [side * .066, .791, .210]));
    add("phoenix_amber_iris", "phoenixCopper", ellipsoid(detailed ? 12 : 6, [.008, .012, .012],
      [side * .074, .792, .216]));
    add("phoenix_pupil", "dark", ellipsoid(detailed ? 10 : 5, [.004, .008, .006],
      [side * .078, .792, .223]));
    tube(add, detailed, "phoenix_raptor_brow", [[side * .042, .808, .245],
      [side * .068, .814, .216], [side * .071, .801, .183]], .01, .005, "phoenixCopper");
  }
  for (let crest = 0; crest < (detailed ? 7 : 3); crest++) {
    const t = crest / (detailed ? 6 : 2), x = (t - .5) * .075;
    add("phoenix_flame_crest", "phoenixCopper", carvedSculptureFeather(
      [[x * .5, .808, .135], [x, .905 + Math.sin(t * Math.PI) * .025, .07],
        [x * 1.65, .985 - Math.abs(t - .5) * .06, -.065]], .013, detailed));
  }
};

/** Shingled contour plumage hugs the real chest, replacing the old broad pinecone-like breast plates. */
export const addPhoenixBreast = (add: Add, detailed: boolean, body: SculptureAnatomy) => {
  const rows = detailed ? 8 : 3, columns = detailed ? 5 : 3;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const y = .245 + row * (detailed ? .049 : .11);
    const neck = y > .57, span = neck ? .046 : .1;
    const x = (column / (columns - 1) - .5) * span * 2 + row % 2 * .008;
    const points = [y + .027, y, y - .055].map((height, index) => {
      const z = anatomySurface(body, [x, height, 0], 2);
      return [x * (index === 2 ? .94 : 1), height, z + (index === 0 ? -.002 : .005)] as SculpturePoint;
    });
    if (points.some(point => point[2] < .025)) continue;
    add("phoenix_breast_plumage", "phoenixCopper", carvedSculptureFeather(points,
      detailed ? .016 : .027, detailed, true));
  }
};

export const addPhoenixFeet = (add: Add, detailed: boolean) => {
  for (const side of [-1, 1]) {
    tube(add, detailed, "phoenix_thigh", [[side * .078, .23, .012],
      [side * .09, .145, .047], [side * .089, .116, .08]], .033, .022, "phoenixCopper");
    tube(add, detailed, "phoenix_tarsus", [[side * .089, .126, .075],
      [side * .098, .072, .095], [side * .10, .028, .10]], .018, .012);
    for (const toe of [-1, 0, 1]) {
      const endX = side * .1 + toe * .029;
      tube(add, detailed, "phoenix_talon_toe", [[side * .1, .03, .10],
        [endX, .009, .151], [endX, -.013, .166]], .009, .004);
      tube(add, detailed, "phoenix_talon_claw", [[endX, -.009, .162],
        [endX, -.027, .167], [endX, -.033, .15]], .005, .0006, "dark");
    }
    tube(add, detailed, "phoenix_rear_talon", [[side * .1, .03, .10],
      [side * .1, .005, .062], [side * .1, -.02, .067]], .008, .001, "dark");
  }
};

/** Narrow overlapping neck hackles follow the fused anatomy instead of leaving a bare upright rod. */
export const addPhoenixNeckPlumage = (add: Add, detailed: boolean, body: SculptureAnatomy) => {
  const rows = detailed ? 5 : 2, columns = detailed ? 10 : 5;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const y = .60 + row * (detailed ? .032 : .10), centreZ = .085 + (y - .6) * .65;
    const angle = column * Math.PI * 2 / columns + row % 2 * Math.PI / columns;
    const surface = (height: number) => {
      let inside = 0, outside = .18;
      for (let step = 0; step < 12; step++) {
        const radius = (inside + outside) / 2;
        if (sculptureAnatomyDistance(body, Math.sin(angle) * radius, height,
          centreZ + Math.cos(angle) * radius) < 0) inside = radius;
        else outside = radius;
      }
      return (inside + outside) / 2;
    };
    const points: SculpturePoint[] = [[0, y + .022, surface(y + .022) - .003],
      [0, y, surface(y) + .005], [0, y - .046, surface(y - .046) + .004]];
    const feather = carvedSculptureFeather(points, detailed ? .011 : .018, detailed, true);
    feather.rotateY(angle).translate(0, 0, centreZ);
    add("phoenix_neck_plumage", "phoenixCopper", feather);
  }
};
