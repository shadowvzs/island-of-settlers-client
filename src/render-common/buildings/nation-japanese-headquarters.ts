import { DMath } from "../../shared/math/deterministic-math";
import { HEADQUARTERS_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { withoutRomanCupola } from "./headquarters-cupola";
import { createNationKitRecipe } from "./nation-architecture-kit";
import { JAPANESE_ROOF_TINTS, japaneseRoofClass, japaneseRoofUnderside } from "./nation-roof-palette";
import { nationRoofMeshHeight, type NationRoofProfile } from "./nation-roof-profile";

/** The Japanese headquarters is a pagoda (owner request 2026-10-12): its building type. */

const VERMILION: Point3 = [.8, .17, .09];
/** Dark patinated bronze of the spire. */
const BRONZE: Point3 = [.3, .27, .2];
/** Soffit of a Japanese roof, in unit roof heights below its centre (nation-roof-geometry). */
const SOFFIT_DEPTH = .49;

/** A storey of the pagoda: its square body and the eave roof over it. */
interface PagodaStorey { body: number; bottom: number; top: number; eave: number; roofHeight: number;
  profile: NationRoofProfile }

/**
 * Three storeys rise from the hall's hip roof (its ridge, 1.17 long, hides inside the first body),
 * each narrower with a shorter body; the crown is a ridge-less pyramid under the spire. The spire
 * tip stays below the Roman statue's top (4.09), the eaves well inside the hall's plan.
 */
const STOREYS: readonly PagodaStorey[] = [
  { body: 1.3, bottom: 1.5, eave: 1.82, profile: "japanese", roofHeight: .38, top: 2.36 },
  { body: 1.12, bottom: 2.5, eave: 1.5, profile: "japanese", roofHeight: .32, top: 2.86 },
  { body: .98, bottom: 2.98, eave: 1.22, profile: "japanese-pyramid", roofHeight: .36, top: 3.28 }
];

const box = (position: Point3, size: Point3, surface: BuildingPart["surface"], tint?: Point3): BuildingPart =>
  ({ position, shape: "box", size, stage: 4, surface, tint });

/** Height of a storey's rendered roof over unit point (x, z). */
const roofY = (storey: PagodaStorey, centre: number, x: number, z: number, detailed: boolean) =>
  centre + storey.roofHeight * nationRoofMeshHeight(storey.profile, detailed, x, z);

/** Vermilion corner posts, a white plastered body, bracket band and (High) dark panels, framed below. */
const storeyBody = (storey: PagodaStorey, detailed: boolean): BuildingPart[] => {
  const { body, bottom, top } = storey, height = top - bottom, middle = (top + bottom) / 2, half = body / 2;
  const parts: BuildingPart[] = [];
  const panel = Math.min(.3, body * .3), panelHeight = Math.min(.20, height * .3);
  // Upper storeys emerge from the preceding swept roof: keep the window above those tiles.
  const panelY = top - .03 - panelHeight / 2;
  // A hollow storey with real openings: the former solid plaster cube and full red frame
  // rectangle both plugged the 50%-opacity shadow plane from behind.
  for (const [axis, sign] of [[0, 1], [0, -1], [2, 1], [2, -1]] as const) {
    const along = axis === 0 ? 2 : 0;
    const section = (left: number, right: number, low: number, high: number) => {
      const position: Point3 = [0, (low + high) / 2, 0], size: Point3 = [.07, high - low, .07];
      position[axis] = sign * (half - .035); position[along] = (left + right) / 2;
      size[along] = right - left;
      parts.push(box(position, size, "plaster"));
    };
    section(-half, -panel / 2, bottom, top); section(panel / 2, half, bottom, top);
    section(-panel / 2, panel / 2, bottom, panelY - panelHeight / 2);
    section(-panel / 2, panel / 2, panelY + panelHeight / 2, top);
    const position: Point3 = [0, panelY, 0]; position[axis] = sign * (half + .008);
    for (const side of [-1, 1]) {
      const jamb: Point3 = [...position], size: Point3 = [.025, panelHeight + .05, .025];
      jamb[along] = side * (panel / 2 + .0125);
      parts.push(box(jamb, size, "paint", VERMILION));
      const rail: Point3 = [...position], railSize: Point3 = [.025, .025, .025];
      rail[1] += side * (panelHeight / 2 + .0125); railSize[along] = panel + .05;
      parts.push(box(rail, railSize, "paint", VERMILION));
    }
    const pane: Point3 = [.012, panelHeight, .012]; pane[along] = panel;
    parts.push({ ...box(position, pane, "dark"), shape: "window-shadow" });
  }
  // Minimal frames only the first storey's corners.
  if (detailed || storey === STOREYS[0]) for (const x of [-1, 1]) for (const z of [-1, 1])
    parts.push(box([x * (half - .02), middle, z * (half - .02)], [.07, height, .07], "paint", VERMILION));
  // Kumimono: the bracket band under the eave, a little wider than the body.
  for (const side of [-1, 1]) {
    parts.push(box([side * (half + .005), top + .015, 0], [.05, .03, body + .06], "wood"));
    parts.push(box([0, top + .015, side * (half + .005)], [body + .06, .03, .05], "wood"));
  }
  return parts;
};

/** The storey's roof with its soffit board (no rafters: the triangle budget goes to the tiled eaves). */
const storeyRoof = (storey: PagodaStorey, tint: Point3): BuildingPart[] => {
  const centre = storey.top + SOFFIT_DEPTH * storey.roofHeight;
  const roof: BuildingPart = { position: [0, centre, 0], roofProfile: storey.profile, shape: "nation-roof",
    size: [storey.eave, storey.roofHeight, storey.eave], stage: 4, surface: "roof", tint };
  return [roof, ...japaneseRoofUnderside(roof, japaneseRoofClass(HEADQUARTERS_TYPE_ID), false)];
};

/** Hip tiles from where each hip leaves the next storey's body down to the upturned corner. */
const hipTiles = (storey: PagodaStorey, above: number, detailed: boolean, tint: Point3): BuildingPart[] => {
  if (!detailed) return [];
  const centre = storey.top + SOFFIT_DEPTH * storey.roofHeight, ridge = storey.profile === "japanese" ? .25 : 0;
  const parts: BuildingPart[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const points = [.45, .84].map(t => {
      const x = sx * .5 * t, z = sz * (ridge + (.5 - ridge) * t);
      return [x * storey.eave, roofY(storey, centre, x, z, true) + .02, z * storey.eave] as Point3;
    }).filter(point => Math.max(Math.abs(point[0]), Math.abs(point[2])) > above / 2 - .04);
    for (let index = 1; index < points.length; index++) parts.push(tileRun(points[index - 1]!, points[index]!, tint));
    const corner = points.at(-1)!;
    parts.push({ position: [corner[0], corner[1] + .05, corner[2]], radialSegments: 6, shape: "cone",
      size: [.04, .1, .04], stage: 4, surface: "gold" });
  }
  return parts;
};

/** A run of hip tiles between two points on the roof. */
const tileRun = (from: Point3, to: Point3, tint: Point3): BuildingPart => {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], flat = DMath.hypot(dx, dz);
  return { position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    rotation: [DMath.atan2(-dy, flat), DMath.atan2(dx, dz), 0], shape: "box",
    size: [.06, .045, DMath.hypot(flat, dy) + .01], stage: 4, surface: "roof", tint };
};

/**
 * Sorin: a roban base and bowl on the crown, a bronze mast with seven rings (High; three on
 * Minimal), the water-flame collar and the gilded jewel on top, under the old statue's height.
 */
const spire = (crown: PagodaStorey, detailed: boolean): BuildingPart[] => {
  const centre = crown.top + SOFFIT_DEPTH * crown.roofHeight, peak = roofY(crown, centre, 0, 0, detailed);
  const base = peak - .05;
  const segments = detailed ? 6 : 4, rings = detailed ? 7 : 3;
  const parts: BuildingPart[] = [
    box([0, base + .04, 0], [.2, .08, .2], "dark"),
    { position: [0, base + .26, 0], radialSegments: segments, shape: "cylinder", size: [.03, .34, .03], stage: 4,
      surface: "paint", tint: BRONZE }
  ];
  if (detailed) parts.push({ position: [0, base + .1, 0], radialSegments: 8, shape: "sphere", size: [.15, .08, .15],
    stage: 4, surface: "paint", tint: BRONZE });
  for (let ring = 0; ring < rings; ring++) parts.push({ position: [0, base + .15 + ring * .2 / rings, 0],
    radialSegments: segments, shape: "cylinder", size: [.09 - ring * .004, .016, .09 - ring * .004],
    stage: 4, surface: "paint", tint: BRONZE });
  parts.push({ position: [0, base + .37, 0], radialSegments: segments, shape: "cone", size: [.07, .06, .07], stage: 4,
    surface: "gold" }, { position: [0, base + .42, 0], radialSegments: segments, shape: "sphere",
    size: [.055, .07, .055], stage: 4, surface: "gold" });
  return parts;
};

/** Hall parts wholly inside the first storey (the hip ridge, its end blocks, ladder top) are never seen. */
const isInsideFirstStorey = (part: BuildingPart) => {
  const { body, bottom, top } = STOREYS[0]!, { max, min } = getRomanPartBounds(part);
  return min[1] >= bottom && max[1] <= top && [0, 2].every(axis => Math.abs(min[axis]!) <= body / 2 &&
    Math.abs(max[axis]!) <= body / 2);
};

const addJapanesePagoda = (recipe: BuildingRecipe, detailed: boolean): BuildingRecipe => {
  const tint = JAPANESE_ROOF_TINTS[japaneseRoofClass(HEADQUARTERS_TYPE_ID)];
  const parts = recipe.parts.filter(part => !isInsideFirstStorey(part));
  STOREYS.forEach((storey, index) => {
    parts.push(...storeyBody(storey, detailed), ...storeyRoof(storey, tint),
      ...hipTiles(storey, STOREYS[index + 1]?.body ?? 0, detailed, tint));
  });
  parts.push(...spire(STOREYS.at(-1)!, detailed));
  return { ...recipe, parts };
};

/**
 * Japanese headquarters as a pagoda: the kit-built hall keeps its plan, door, portico, wings and
 * all anchors; three diminishing storeys with swept eaves and a sorin spire replace the cupola.
 * Rollback: drop this design in nation-building-recipe and the kit rebuilds the original hall with
 * its hipped cupola from the unchanged Roman recipe.
 */
export const createJapanesePagodaRecipe = (original: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean) =>
  addJapanesePagoda(createNationKitRecipe(withoutRomanCupola(original), definition, "japanese", detailed), detailed);
