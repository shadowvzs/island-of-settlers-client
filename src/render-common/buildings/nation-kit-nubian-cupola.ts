import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { NationBody, RoofEnvelope } from "./nation-kit-classify";
import { type Add, envelopeCenter, envelopeSize, type KitContext,MASONRY_SURFACES } from "./nation-kit-parts";

/** A round Roman roof rebuilt as a Nubian dome; `deck` is the flat terrace a raised cupola stands on. */
export interface NubianCupolaSite { roof: RoofEnvelope; deck?: RoofEnvelope }

const DECK_TOP = .06;
const PARAPET_CLEARANCE = .18;
const PLINTH_HEIGHT = .12;
const CORNICE_HEIGHT = .07;
const DRUM_TAPER = .9;
const OCHRE: Point3 = [.62, .2, .12];
const CREAM: Point3 = [.95, .9, .78];
const UMBER: Point3 = [.2, .13, .1];
const OSTRICH_EGG: Point3 = [.97, .94, .86];

const radial = (angle: number, radius: number, y: number, center: Point3): Point3 =>
  [center[0] + DMath.sin(angle) * radius, y, center[2] + DMath.cos(angle) * radius];

const containsPlan = (roof: RoofEnvelope, point: Point3) => point[0] > roof.min[0] && point[0] < roof.max[0] &&
  point[2] > roof.min[2] && point[2] < roof.max[2];

const underRoof = (part: BuildingPart, roof: RoofEnvelope) => {
  const center = envelopeCenter(roof);
  return DMath.hypot(part.position[0] - center[0], part.position[2] - center[2]) < envelopeSize(roof).width / 2 + .05;
};

/** Roman columns standing on the terrace carry the cupola (a lantern tower rising from the ground does not). */
const isColonnadeOn = (keep: readonly BuildingPart[], roof: RoofEnvelope, deck: RoofEnvelope) => keep.some(part => {
  if (part.stock || part.shape !== "cylinder" || part.size[1] < .3 || !MASONRY_SURFACES.has(part.surface)) return false;
  const foot = getRomanPartBounds(part).min[1];
  return foot >= deck.min[1] - .02 && foot <= deck.max[1] + .1 && underRoof(part, roof);
});

/** Round roofs; a cupola carried by columns on a lower terrace gets that terrace as its deck. */
export const nubianCupolaSites = (body: NationBody): NubianCupolaSite[] => body.roofs.filter(roof => roof.round)
  .map(roof => {
    const center = envelopeCenter(roof);
    const deck = body.roofs.filter(other => !other.round && other.max[1] < roof.min[1] && containsPlan(other, center))
      .sort((a, b) => b.min[1] - a.min[1])[0];
    return deck && isColonnadeOn(body.keep, roof, deck) ? { deck, roof } : { roof };
  });

/**
 * Roman pieces the Nubian dome replaces: a raised cupola's colonnade, ring floor and statue down to its
 * terrace, or a lantern roof's finial.
 */
export const isInCupolaColumn = (part: BuildingPart, bounds: { min: Point3 }, sites: readonly NubianCupolaSite[]) =>
  !part.stock && sites.some(({ deck, roof }) => bounds.min[1] >= (deck ?? roof).min[1] && underRoof(part, roof));

/** Brass spike threaded with ostrich eggs and a ball, ending in a point: the cupola's crown. */
const addFinial = (add: Add, apex: Point3, scale: number, detailed: boolean) => {
  const [x, y, z] = apex, at = (height: number): Point3 => [x, y + height * scale, z];
  add({ position: at(.02), shape: "cylinder", size: [.16 * scale, .1 * scale, .16 * scale], stage: 4,
    surface: "plaster", topScale: [.55, 1, .55] });
  add({ position: at(.36), radialSegments: 6, shape: "cylinder", size: [.035 * scale, .62 * scale, .035 * scale],
    stage: 4, surface: "gold" });
  add({ position: at(.2), shape: "sphere", size: [.11 * scale, .15 * scale, .11 * scale], stage: 4, surface: "paint",
    tint: OSTRICH_EGG });
  if (detailed) {
    add({ position: at(.36), shape: "sphere", size: [.08 * scale, .08 * scale, .08 * scale], stage: 4,
      surface: "gold" });
    add({ position: at(.5), shape: "sphere", size: [.09 * scale, .12 * scale, .09 * scale], stage: 4, surface: "paint",
      tint: OSTRICH_EGG });
  }
  add({ position: at(.72), shape: "cone", size: [.06 * scale, .14 * scale, .06 * scale], stage: 4, surface: "gold" });
};

/** Pointed mud dome seated on `base` (its open ring closed by the drum or ring below) and crowned. */
const addDome = (add: Add, base: Point3, radius: number, height: number, finial: number, detailed: boolean) => {
  add({ position: [base[0], base[1] + height / 2, base[2]], shape: "ogive-dome", size: [radius * 2, height, radius * 2],
    stage: 4, surface: "roof" });
  addFinial(add, [base[0], base[1] + height, base[2]], finial, detailed);
};

interface Drum { bottom: number; center: Point3; radius: number; top: number }

const drumRadiusAt = (drum: Drum, y: number) =>
  drum.radius * (1 + (DRUM_TAPER - 1) * (y - drum.bottom) / (drum.top - drum.bottom));

/** Tapered crenellated pinnacles standing on the plinth around the drum foot. */
const addPinnacles = (add: Add, drum: Drum, ring: number, detailed: boolean) => {
  const count = detailed ? 12 : 8;
  for (let index = 0; index < count; index++) {
    const angle = (index + .5) * Math.PI * 2 / count;
    add({ position: radial(angle, ring, drum.bottom + .1, drum.center), radialSegments: detailed ? 6 : 4,
      shape: "cylinder", size: [.1, .2, .1], stage: 3, surface: "plaster", topScale: [.5, 1, .5] });
    if (detailed) add({ position: radial(angle, ring, drum.bottom + .235, drum.center), shape: "cone",
      size: [.05, .08, .05], stage: 3, surface: "plaster" });
  }
};

/** Toron palm beams pushed through the drum wall, projecting outdoors (scaffolding for re-plastering). */
const addToronBeams = (add: Add, drum: Drum, detailed: boolean) => {
  const rows = detailed ? [.38, .68] : [.55], count = detailed ? 10 : 6;
  rows.forEach((fraction, row) => {
    const y = drum.bottom + (drum.top - drum.bottom) * fraction, radius = drumRadiusAt(drum, y) + .02;
    for (let index = 0; index < count; index++) {
      const angle = (index + row * .5) * Math.PI * 2 / count;
      add({ position: radial(angle, radius, y, drum.center), radialSegments: 6, rotation: [Math.PI / 2, angle, 0],
        shape: "cylinder", size: [.045, .24, .045], stage: 3, surface: "wood" });
    }
  });
};

/** Ochre band; High adds cream and umber zigzag triangles and four small vents. */
const addPaintedBand = (add: Add, drum: Drum, detailed: boolean) => {
  const y = drum.bottom + (drum.top - drum.bottom) * .86, radius = drumRadiusAt(drum, y) + .006;
  add({ position: [drum.center[0], y, drum.center[2]], radialSegments: detailed ? 20 : 10, shape: "cylinder",
    size: [radius * 2, .1, radius * 2], stage: 3, surface: "paint", tint: OCHRE });
  if (!detailed) return;
  for (let index = 0; index < 18; index++) {
    const angle = index * Math.PI / 9, up = index % 2 === 0;
    // A flipped triangle turns half round as well, so its painted face still looks outdoors.
    const rotation: Point3 = up ? [0, angle, 0] : [Math.PI, angle + Math.PI, 0];
    add({ position: radial(angle, radius + .004, y, drum.center), rotation,
      shape: "paint-triangle", size: [.1, .07, .01], stage: 3, surface: "paint", tint: up ? CREAM : UMBER });
  }
  const ventY = drum.bottom + (drum.top - drum.bottom) * .53;
  for (let index = 0; index < 4; index++) {
    const angle = (index + .5) * Math.PI / 2;
    add({ position: radial(angle, drumRadiusAt(drum, ventY) - .008, ventY, drum.center), rotation: [0, angle, 0],
      shape: "window-shadow", size: [.09, .16, .03], stage: 3, surface: "dark" });
  }
};

/** Raised cupola: plinth, battered drum with beams and painted band, cornice, pointed dome and finial. */
const addDrumCupola = (context: KitContext, roof: RoofEnvelope, deck: RoofEnvelope) => {
  const { add, detailed } = context, deckSize = envelopeSize(deck), center = envelopeCenter(roof);
  const terrace = Math.min(deckSize.width, deckSize.depth) / 2 - PARAPET_CLEARANCE;
  const plinth = Math.min(envelopeSize(roof).width / 2, terrace);
  const base = deck.min[1] + DECK_TOP, domeBase = roof.min[1] - .1, segments = detailed ? 20 : 10;
  const drum: Drum = { bottom: base + PLINTH_HEIGHT, center, radius: plinth - .13, top: domeBase - CORNICE_HEIGHT };
  add({ position: [center[0], base + PLINTH_HEIGHT / 2, center[2]], radialSegments: segments, shape: "cylinder",
    size: [plinth * 2, PLINTH_HEIGHT, plinth * 2], stage: 3, surface: "plaster" });
  add({ position: [center[0], (drum.bottom + drum.top) / 2, center[2]], radialSegments: segments, shape: "cylinder",
    size: [drum.radius * 2, drum.top - drum.bottom, drum.radius * 2], stage: 3, surface: "plaster",
    topScale: [DRUM_TAPER, 1, DRUM_TAPER] });
  const top = drum.radius * DRUM_TAPER;
  add({ position: [center[0], drum.top + CORNICE_HEIGHT / 2, center[2]], radialSegments: segments, shape: "cylinder",
    size: [top * 2 + .09, CORNICE_HEIGHT, top * 2 + .09], stage: 3, surface: "plaster" });
  addPinnacles(add, drum, plinth - .07, detailed);
  addToronBeams(add, drum, detailed);
  addPaintedBand(add, drum, detailed);
  addDome(add, [center[0], domeBase, center[2]], top, top * 1.25, 1, detailed);
};

/** A round roof becomes a Nubian dome: a full drum cupola on a terrace, or a dome cap on its own ring. */
export const nubianCupola = (context: KitContext, { deck, roof }: NubianCupolaSite) => {
  if (deck) { addDrumCupola(context, roof, deck); return; }
  const radius = envelopeSize(roof).width * .44;
  addDome(context.add, envelopeCenter(roof), radius, radius * 1.2, .6, context.detailed);
};
