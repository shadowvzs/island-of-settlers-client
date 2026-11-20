import type { Point3 } from "../building-recipe";
import { JAPANESE_ROOF_TINTS, japaneseRoofClass } from "../nation-roof-palette";
import { crownPoint, crownScale, footprintFloor } from "./level-crown-roman";
import type { DormerStyle } from "./level-dormer";
import { heightCap, type LevelKit, ridgeHalfLength } from "./level-kit";
import { isLeanPiece } from "./level-lean";
import { isRoofSpotFree, ridgeAxisOf } from "./level-roof-pieces";
import { addRoofVentWindow } from "./level-roof-vent";

/** Ridge pavilion at full size: drum, pyramid (hōgyō) roof and the jewel (hōju) on it. */
const PAVILION = { drum: .13, jewel: .07, roof: .17, width: .24 } as const;
const PAVILION_HEIGHT = PAVILION.drum + PAVILION.roof + PAVILION.jewel;

/** Chidori-hafu: a plastered gable with a dark ridge-end tile, a lattice window under it. */
export const JAPANESE_DORMER: DormerStyle = { gable: "plaster", wall: "plaster", window: "lattice",
  ornament: (kit, apex) => kit.add({ position: [apex[0], apex[1] + .03, apex[2]], shape: "bevel-box",
    size: [.06, .08, .06], stage: 4, surface: "roof", tint: JAPANESE_ROOF_TINTS[japaneseRoofClass(kit.site.definition.id)] }) };

/** Ridge pavilion: a timber drum with dark slats, a small hōgyō roof in the building's tile and a gilded jewel. */
const ridgePavilion = (kit: LevelKit, crown: Point3) => {
  const scale = crownScale(kit, crown[1], PAVILION_HEIGHT);
  if (scale < .55) return;
  const [x, ridge, z] = crown, width = PAVILION.width * scale, drum = PAVILION.drum * scale;
  if (!isRoofSpotFree(kit, [x, ridge + PAVILION_HEIGHT * scale / 2, z], [width + .14, PAVILION_HEIGHT * scale,
    width + .14], ridge)) return;
  const floor = footprintFloor(kit, crown, width / 2) - .02, eave = ridge + drum;
  const openingY = ridge + drum * .55, openingHeight = drum * .45, post = Math.min(.02, width * .12);
  const sill = openingY - openingHeight / 2, header = openingY + openingHeight / 2;
  kit.add({ position: [x, (floor + sill) / 2, z], shape: "box", size: [width, sill - floor, width],
    stage: 4, surface: "wood" });
  kit.add({ position: [x, (header + eave) / 2, z], shape: "box", size: [width, eave - header, width],
    stage: 4, surface: "wood" });
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1])
    kit.add({ position: [x + sideX * (width - post) / 2, openingY, z + sideZ * (width - post) / 2],
      shape: "box", size: [post, openingHeight, post], stage: 4, surface: "wood" });
  for (const axis of [0, 2] as const) for (const side of [-1, 1]) {
    const face: Point3 = [x, openingY, z], outward: Point3 = [0, 0, 0];
    face[axis] += side * (width / 2 - post / 2); outward[axis] = side;
    addRoofVentWindow(kit, face, outward, width - post * 2, openingHeight);
  }
  const tint = JAPANESE_ROOF_TINTS[japaneseRoofClass(kit.site.definition.id)], roof = PAVILION.roof * scale;
  kit.add({ position: [x, eave + roof / 2 - .01, z], roofProfile: "japanese-pyramid", shape: "nation-roof",
    size: [width + .16, roof, width + .16], stage: 4, surface: "roof", tint });
  kit.add({ position: [x, eave + roof + PAVILION.jewel * scale / 2 - .02, z], shape: "sphere",
    size: [.06 * scale, PAVILION.jewel * scale, .06 * scale], stage: 4, surface: "gold",
    radialSegments: kit.detailed ? 8 : 4 });
};

/** Gilded shachihoko on both ridge ends: carp standing on their heads, tails high, facing each other. */
const shachihoko = (kit: LevelKit) => {
  const roof = kit.site.roof!, axis = ridgeAxisOf(kit), half = ridgeHalfLength(kit.site);
  if (half < .1) return;
  for (const end of [-1, 1]) {
    const point: Point3 = [...roof.centre];
    point[axis] += end * (half + .02);
    const top = kit.site.topAt(point[0], point[2]) ?? roof.top;
    if (top + .2 > heightCap(kit.site)) continue;
    // A gilded body curving up into the forked tail (the tail faces the ridge's other end).
    const inward = -end, tail: Point3 = [...point];
    tail[axis] += inward * .03;
    kit.add({ position: [point[0], top + .07, point[2]], radialSegments: kit.detailed ? 6 : 4, shape: "cone",
      size: [.08, .16, .08], stage: 4, surface: "gold" });
    kit.add({ position: [tail[0], top + .19, tail[2]], rotation: [0, axis === 0 ? 0 : Math.PI / 2, Math.PI / 2],
      shape: "fish-tail", size: [.12, .1, .02], stage: 4, surface: "gold" });
  }
};

/** Level 5 Japanese crown: ridge pavilion and shachihoko. */
export const addJapaneseCrown = (kit: LevelKit) => {
  const crown = crownPoint(kit);
  if (!crown) return;
  if (kit.site.roof!.ridgeAxis !== null) {
    ridgePavilion(kit, crown);
    if (!isLeanPiece(kit.site, "crown-ornaments")) shachihoko(kit);
  }
};
