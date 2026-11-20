import { add, CritterBuilder, type LoftStation, scale, sub, unit } from "../critters/model/critter-builder";
import { cross, dot, type Vec3 } from "../props/mesh-builder";
import { type FinShape, sampleProfile, WHALE_SHAPES, type WhaleShape, type WhaleSpecies } from "./whale-species";

/**
 * Whale meshes in body lengths (see whale-species.ts). Each vertex carries a skin coordinate the
 * shaders paint and bump procedurally (no texture): x = part + a fraction (body: position along
 * it 0 nose .. 1; fins: chord 0 leading .. 1 trailing edge), y = body: up share of the ring
 * (1 dorsal .. -1 ventral), fins: span 0 root .. 1 tip; z = body: left share, fins: 1 on the
 * upper (dorsal / outer) surface .. -1 on the lower. `spine` is the body position the vertex
 * bends with (from its x).
 */
export const WHALE_PART = {
  body: 0,
  dorsal: 3,
  flukeLeft: 4,
  flukeRight: 5,
  pectoralLeft: 1,
  pectoralRight: 2
} as const;

/** A part's fraction is stored in (offset .. offset + span), strictly inside its integer interval. */
export const WHALE_SKIN_FRACTION = { offset: 0.0005, span: 0.998 } as const;

/**
 * Skin x of a part and a fraction 0..1: kept strictly inside (part, part + 1), so interpolation
 * never rounds an edge vertex into the neighbouring part (it painted the dorsal edge as a flipper).
 */
const encodePart = (part: number, fraction: number) =>
  part + WHALE_SKIN_FRACTION.offset + fraction * WHALE_SKIN_FRACTION.span;

export interface WhaleDetail {
  bodyRings: number;
  bodySides: number;
  finRings: number;
  finSides: number;
}

export const WHALE_DETAIL: Readonly<Record<"full" | "lite", WhaleDetail>> = {
  full: { bodyRings: 72, bodySides: 40, finRings: 14, finSides: 12 },
  lite: { bodyRings: 22, bodySides: 12, finRings: 6, finSides: 5 }
};

export interface WhaleMesh {
  indices: Uint16Array;
  normals: Float32Array;
  positions: Float32Array;
  skin: Float32Array;
  spine: Float32Array;
}

/** Body position of a ring: denser towards the head (mouth, eye and blowhole detail). */
const bodyPosition = (shape: WhaleShape, along: number) =>
  Math.max(0.003, shape.bodyEnd * (0.55 * along + 0.45 * along * along));

const addBody = (builder: CritterBuilder, shape: WhaleShape, detail: WhaleDetail) => {
  const stations: LoftStation[] = [];
  for (let ring = 0; ring <= detail.bodyRings; ring += 1) {
    const at = bodyPosition(shape, ring / detail.bodyRings);
    const top = sampleProfile(shape.top, at);
    const bottom = sampleProfile(shape.bottom, at);
    stations.push({
      at: [0.5 - at, (top - bottom) / 2, 0],
      height: (top + bottom) / 2,
      up: [0, 1, 0],
      width: sampleProfile(shape.width, at)
    });
  }
  builder.loft(stations, {
    endTip: 0.004,
    paint: (along, up, left) => [encodePart(WHALE_PART.body, bodyPosition(shape, along)), up, left],
    sides: detail.bodySides,
    startTip: 0.006
  });
};

const mirror = (vector: Vec3): Vec3 => [vector[0], vector[1], -vector[2]];

/** The root ring sits this far (body lengths) inside the body: no seam at the join. */
const ROOT_SINK = 0.02;
/** Fleshy base: chord and thickness flare by this share towards the root over the first span share. */
const FILLET = { reach: 0.14, share: 0.4 } as const;

/** Symmetric airfoil half thickness (NACA 00xx form, 1 at its thickest, closed at the trailing edge). */
const airfoil = (chord: number) =>
  (0.2969 * Math.sqrt(chord) - 0.126 * chord - 0.3516 * chord ** 2 + 0.2843 * chord ** 3 - 0.1036 * chord ** 4)
  / 0.1002;

interface FinFrame {
  chordDirection: Vec3;
  normal: Vec3;
  part: number;
  root: Vec3;
  spanDirection: Vec3;
  upper: number;
}

const createFinFrame = (fin: FinShape, part: number, mirrored: boolean): FinFrame => {
  const spanDirection = unit(mirrored ? mirror(fin.spanDirection) : fin.spanDirection);
  const rawChord = unit(mirrored ? mirror(fin.chordDirection) : fin.chordDirection);
  // Chord kept square to the span; the airfoil's thickness along their normal.
  const chordDirection = unit(add(rawChord, scale(spanDirection, -dot(rawChord, spanDirection))));
  const normal = unit(cross(spanDirection, chordDirection));
  const reference: Vec3 = part === WHALE_PART.dorsal ? [0, 0, 1] : [0, 1, 0];
  const root = mirrored ? mirror(fin.root) : fin.root;
  return { chordDirection, normal, part, root, spanDirection, upper: Math.sign(dot(normal, reference)) || 1 };
};

/** One airfoil ring: rounded leading edge, thin trailing edge (cosine spaced along the chord). */
const addFinRing = (builder: CritterBuilder, fin: FinShape, frame: FinFrame, span: number, sides: number) => {
  const profileSpan = Math.max(0, span);
  const flare = 1 + FILLET.share * Math.max(0, 1 - profileSpan / FILLET.reach) ** 2;
  const chord = sampleProfile(fin.chord, profileSpan) * flare;
  const thickness = sampleProfile(fin.thickness, profileSpan) * flare;
  const centre = add(add(frame.root, scale(frame.spanDirection, span * fin.span)),
    [-sampleProfile(fin.sweep, profileSpan), 0, 0]);
  const ring: number[] = [];
  const points: Vec3[] = [];
  for (let side = 0; side < sides; side += 1) {
    const angle = (side / sides) * Math.PI * 2;
    const along = (1 - Math.cos(angle)) / 2;
    const surface = Math.sign(Math.sin(angle));
    const point = add(add(centre, scale(frame.chordDirection, (0.5 - along) * chord)),
      scale(frame.normal, surface * thickness * airfoil(along)));
    points.push(point);
    ring.push(builder.vertex(point, [encodePart(frame.part, along), profileSpan, surface * frame.upper]));
  }
  return { centre, points, ring };
};

const addFin = (
  builder: CritterBuilder,
  fin: FinShape,
  part: number,
  detail: WhaleDetail,
  mirrored: boolean
) => {
  const frame = createFinFrame(fin, part, mirrored);
  const sides = detail.finSides * 2;
  const first = -ROOT_SINK / fin.span;
  let previous = addFinRing(builder, fin, frame, first, sides);
  for (let index = 1; index <= detail.finRings; index += 1) {
    const span = first + (1 - first) * (index / detail.finRings);
    const next = addFinRing(builder, fin, frame, span, sides);
    for (let side = 0; side < sides; side += 1) {
      const following = (side + 1) % sides;
      builder.quad(previous.ring[side]!, previous.ring[following]!, next.ring[following]!, next.ring[side]!,
        sub(previous.points[side]!, previous.centre));
    }
    previous = next;
  }
  const tip = builder.vertex(add(previous.centre, scale(frame.spanDirection, 0.004)), [encodePart(part, 0.5), 1, 0]);
  for (let side = 0; side < sides; side += 1)
    builder.triangle(tip, previous.ring[side]!, previous.ring[(side + 1) % sides]!, frame.spanDirection);
};

/** Indexed whale mesh of a species at a detail level (body lengths; scale by the shape's length). */
export const buildWhaleMesh = (species: WhaleSpecies, detail: WhaleDetail): WhaleMesh => {
  const shape = WHALE_SHAPES[species]!;
  const builder = new CritterBuilder();
  addBody(builder, shape, detail);
  addFin(builder, shape.pectoral, WHALE_PART.pectoralLeft, detail, false);
  addFin(builder, shape.pectoral, WHALE_PART.pectoralRight, detail, true);
  addFin(builder, shape.dorsal, WHALE_PART.dorsal, detail, false);
  addFin(builder, shape.fluke, WHALE_PART.flukeLeft, detail, false);
  addFin(builder, shape.fluke, WHALE_PART.flukeRight, detail, true);
  const mesh = builder.finish();
  const spine = new Float32Array(mesh.positions.length / 3);
  for (let vertex = 0; vertex < spine.length; vertex += 1) spine[vertex] = 0.5 - mesh.positions[vertex * 3]!;
  return { indices: mesh.indices, normals: mesh.normals, positions: mesh.positions, skin: mesh.colors, spine };
};
