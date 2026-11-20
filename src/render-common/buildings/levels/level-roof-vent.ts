import type { BuildingSurface, Point3 } from "../building-recipe";
import { createWindowShadowPane } from "../building-window-shadows";
import type { LevelKit } from "./level-kit";

type VentKit = Pick<LevelKit, "add" | "detailed">;

/** An actual roof opening: recessed alpha-black interior, opaque timber jambs and sloping slats. */
export const addRoofVentWindow = (kit: VentKit, centre: Point3, out: Point3, width: number,
  height: number, louvers = false) => {
  const across = out[0] ? 0 : 2, along = across === 0 ? 2 : 0;
  const dimensions = (span: number, tall: number, depth: number): Point3 =>
    across === 0 ? [depth, tall, span] : [span, tall, depth];
  kit.add(createWindowShadowPane({ position: [...centre], shape: "box", size: dimensions(width, height, .01),
    stage: 4, surface: "dark", windowShadowDecorative: true }, .014, out));
  if (!louvers) return;
  const jamb = Math.min(.014, height * .12), depth = .028;
  for (const side of [-1, 1]) {
    const post: Point3 = [...centre];
    post[along] += side * (width / 2 + jamb / 2);
    kit.add({ position: post, shape: "box", size: dimensions(jamb, height + jamb * 2, depth),
      stage: 4, surface: "wood" });
    const rail: Point3 = [...centre]; rail[1] += side * (height / 2 + jamb / 2);
    kit.add({ position: rail, shape: "box", size: dimensions(width, jamb, depth), stage: 4, surface: "wood" });
  }
  let count = kit.detailed ? 3 : 2;
  if (height < .06) count = 1;
  for (let index = 0; index < count; index++) {
    const position: Point3 = [...centre];
    position[1] += height * ((index + 1) / (count + 1) - .5);
    const rotation: Point3 = across === 0 ? [0, 0, -.28 * out[0]] : [.28 * out[2], 0, 0];
    kit.add({ position, rotation, shape: "box", size: dimensions(width + jamb * .4, Math.min(.01, height * .12), depth),
      stage: 4, surface: "wood" });
  }
};

/** Four real corner bearings leave the space between floor and cornice open in both LODs. */
export const addOpenRoofVentStorey = (kit: VentKit, centre: Point3, width: number, height: number,
  post: number, louvers: boolean) => {
  for (const x of [-1, 1]) for (const z of [-1, 1])
    kit.add({ position: [centre[0] + x * (width - post) / 2, centre[1], centre[2] + z * (width - post) / 2],
      radialSegments: kit.detailed ? 8 : undefined, shape: kit.detailed ? "cylinder" : "box",
      size: [post, height, post], stage: 4, surface: "cut-stone" });
  for (const axis of [0, 2] as const) for (const side of [-1, 1]) {
    const face: Point3 = [...centre], out: Point3 = [0, 0, 0];
    face[axis] += side * (width / 2 - post / 2); out[axis] = side;
    addRoofVentWindow(kit, face, out, width - post * 2, height - .012, louvers);
  }
};

/** A dormer's cheeks and front reveal surround a real opening instead of hiding a dark decal on a solid box. */
export const addOpenDormerBody = (kit: VentKit, front: Point3, out: Point3, bottom: number,
  eave: number, width: number, depth: number, opening: number, surface: BuildingSurface) => {
  const across = out[0] ? 0 : 2, along = across === 0 ? 2 : 0, thickness = .025;
  const add = (span: number, height: number, deep: number, lateral: number, y: number, setback: number) => {
    if (height <= 0 || deep <= 0) return;
    const position: Point3 = [...front];
    position[along] += lateral; position[1] = y; position[across] -= out[across]! * setback;
    kit.add({ position, shape: "box", size: across === 0 ? [deep, height, span] : [span, height, deep],
      stage: 4, surface });
  };
  const height = eave - bottom, centreY = (eave + bottom) / 2;
  for (const side of [-1, 1]) {
    add(thickness, height, depth - thickness * 2, side * (width - thickness) / 2, centreY, depth / 2);
    const strip = (width - opening) / 2;
    add(strip, height, thickness, side * (opening + strip) / 2, centreY, thickness / 2);
  }
  add(width, height, thickness, 0, centreY, depth - thickness / 2);
  const windowY = front[1] + (eave - front[1]) / 2;
  const sillTop = windowY - opening / 2, headBottom = windowY + opening / 2;
  add(opening, sillTop - bottom, thickness, 0, (sillTop + bottom) / 2, thickness / 2);
  add(opening, eave - headBottom, thickness, 0, (eave + headBottom) / 2, thickness / 2);
};
