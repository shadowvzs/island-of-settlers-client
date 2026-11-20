import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingSurface,Point3 } from "./building-recipe";
import type { AddPart } from "./roman-resource-workshops";

/** Thin segments use boxes so detailed nets remain inexpensive at strategy-camera distance. */
const segment = (part: AddPart, surface: BuildingSurface, a: Point3, b: Point3, radius: number) => {
  const dy = b[1] - a[1],
    dz = b[2] - a[2];
  part(
    surface,
    [a[0], (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    [radius, DMath.hypot(dy, dz), radius],
    3,
    "box",
    [DMath.atan2(dz, dy), 0, 0]
  );
};

export const addFishingNet = (part: AddPart, x: number, z: number, detailed: boolean) => {
  const rows = detailed ? 9 : 4,
    cols = detailed ? 9 : 5;
  const point = (r: number, c: number): Point3 => {
    const t = c / (cols - 1),
      v = r / rows;
    const bend = 1 - Math.abs(t * 2 - 1);
    const sag = DMath.sin((t % 0.5) * 2 * Math.PI) * 0.19;
    return [
      x + 0.12 + bend * 0.56 + DMath.sin(v * Math.PI) * 0.025,
      1.52 + bend * 0.14 - sag - v * 0.95,
      z - 0.62 + t * 1.24
    ];
  };
  const cord = (a: Point3, b: Point3, thickness: number) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const length = DMath.hypot(dx, dy, dz);
    part(
      "rope",
      [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
      [thickness, length, thickness],
      3,
      "box",
      [DMath.acos(dy / length), DMath.atan2(dx, dz), 0]
    );
  };
  // Three grounded poles form a bent drying area; the middle pole projects outward.
  for (const c of [0, (cols - 1) / 2, cols - 1]) {
    const top = point(0, c);
    part(
      "bark",
      [top[0], (top[1] + 0.18) / 2, top[2]],
      [0.045, top[1] - 0.18 + 0.08, 0.045],
      2,
      "cylinder"
    );
    part("rope", top, [0.062, 0.028, 0.062], 3, "cylinder");
    cord(point(0, c), point(rows, c), 0.009);
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) cord(point(r, c), point(r + 1, c + 1), detailed ? 0.0037 : 0.007);
      if (c > 0) cord(point(r, c), point(r + 1, c - 1), detailed ? 0.0037 : 0.007);
      if (detailed && r % 2 === 0)
        part("rope", point(r, c), [0.01, 0.008, 0.01], 3, "cord", [Math.PI / 2, 0, 0]);
    }
  for (let c = 0; c < cols - 1; c++) {
    cord(point(0, c), point(0, c + 1), 0.011);
    cord(point(rows, c), point(rows, c + 1), 0.008);
  }
  if (detailed)
    for (let c = 0; c < cols; c += 2) {
      const top = point(0, c),
        bottom = point(rows, c);
      part("endgrain", top, [0.032, 0.04, 0.032], 3, "cylinder");
      part("iron", [bottom[0], bottom[1] - 0.01, bottom[2]], [0.022, 0.027, 0.022], 3);
    }
};

export const addFishingEquipment = (part: AddPart, width: number, depth: number) => {
  const x = width / 2 + 0.055;
  for (let i = 0; i < 2; i++) {
    const z = depth * 0.25 + i * 0.12;
    segment(part, "wood", [x, 0.18, z + 0.12], [x, 1.22, z - 0.09], 0.018);
    segment(part, "endgrain", [x, 1.22, z - 0.09], [x, 0.62, z - 0.04], 0.003);
    part("iron", [x, 0.6, z - 0.04], [0.012, 0.04, 0.025], 3);
    part("wood", [x + 0.018, 0.48, z + 0.06], [0.048, 0.05, 0.04], 3, "cylinder", [
      0,
      0,
      Math.PI / 2
    ]);
  }
  part("wood", [x, 0.65, depth * 0.25], [0.07, 0.035, 0.3], 3);
  part("iron", [width / 2 + 0.025, 0.83, -0.42], [0.075, 0.025, 0.035], 3);
  // Paddle mounted on the rear half of the side wall.
  part("wood", [x, 0.73, -0.42], [0.025, 0.91, 0.025], 3);
  part("wood", [x, 0.36, -0.42], [0.045, 0.21, 0.12], 3, "sphere");
};

export const addNurseryEquipment = (part: AddPart, width: number, depth: number) => {
  const front = depth / 2 + 0.09;
  // Wall shelf holds seed pots, with brackets touching the plaster.
  part("wood", [0.35, 0.57, front + 0.045], [0.55, 0.045, 0.16], 3);
  for (const side of [-1, 1])
    part("wood", [0.35 + side * 0.19, 0.51, front], [0.035, 0.11, 0.11], 3);
  for (let i = 0; i < 3; i++) {
    part("roof", [0.18 + i * 0.16, 0.63, front + 0.045], [0.095, 0.075, 0.095], 3, "cylinder");
    part("dark", [0.18 + i * 0.16, 0.67, front + 0.045], [0.075, 0.008, 0.075], 3, "cylinder");
  }
  const x = width / 2 + 0.07;
  // The spade stands pushed into the soil (blade tip below the 0.18 ground line), so it needs no
  // wall to lean on in nations whose corners have no masonry pilaster.
  part("wood", [x, 0.675, -depth / 2 - .065], [0.024, 0.94, 0.024], 3);
  part("iron", [x, 0.245, -depth / 2 - .065], [0.045, 0.17, 0.12], 3);
  part("wood", [x, 0.68, -depth / 2 - .2], [0.023, 1.0, 0.023], 3);
  part("iron", [x, 1.07, -depth / 2 - .2], [0.035, 0.04, 0.22], 3);
};

export const addMasonryEquipment = (part: AddPart, width: number, depth: number) => {
  const front = depth / 2 + 0.09;
  part("wood", [-0.4, 0.87, front], [0.49, 0.055, 0.09], 3);
  for (let i = 0; i < 3; i++) {
    part("iron", [-0.56 + i * 0.15, 0.81, front + 0.045], [0.025, 0.23, 0.025], 3);
    part("wood", [-0.56 + i * 0.15, 0.92, front + 0.045], [0.05, 0.035, 0.035], 3);
  }
  const x = width / 2 + 0.05;
  // Measuring square lies flat against the side wall beside the cutting bench.
  part("wood", [x, 0.97, 0.24], [0.035, 0.25, 0.04], 3);
  part("wood", [x, 0.86, 0.34], [0.035, 0.04, 0.24], 3);
};
