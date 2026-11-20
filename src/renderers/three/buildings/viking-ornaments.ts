import {
  BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Path, Shape, Vector2
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import {
  VIKING_ORNAMENT_BOXES, type VikingOrnamentShape
} from "../../../render-common/buildings/viking-ornament-boxes";
import {
type AtlasRect,   createColouredSculpt, curveThrough, ellipsoid, fitUnitBox, type SculptPoint,
taperedTube} from "../sculpt-geometry";
import { createVikingRoundShieldGeometry } from "../viking-round-shield";
import { RUNE_PLINTH_ATLAS } from "./viking-statue-textures";
import { createVikingThorStatue } from "./viking-thor-statue";
import { createFeatherWing, createVikingHelmet } from "./viking-winged-helmet";

type Outline = readonly (readonly [number, number])[];

const shapeOf = (outline: Outline) => new Shape(outline.map(([x, y]) => new Vector2(x, y)));

/** A flat carved profile (x forward, y up) extruded to `depth`, centred on z. */
const carvedProfile = (shape: Shape, depth: number, curveSegments = 4) =>
  new ExtrudeGeometry(shape, { bevelEnabled: false, curveSegments, depth }).translate(0, 0, -depth / 2);

/** Plain geometry fitted to its ornament box (UVs and colours are supplied by the building pipeline). */
const fitted = (shape: VikingOrnamentShape, geometry: BufferGeometry) => {
  const { max, min } = VIKING_ORNAMENT_BOXES[shape];
  return fitUnitBox(geometry, { max, min });
};

/**
 * Gable dragon in the manner of the stave-church barge-board heads: a carved board with an arched
 * neck, open jaws, upturned snout, swept horn, maned nape and (High) a pierced eye.
 */
const DRAGON_HEAD: Outline = [[.1, 0], [.13, .22], [.2, .42], [.34, .52], [.56, .58], [.7, .66], [.6, .68], [.4, .7],
  [.62, .77], [.78, .82], [.82, .88], [.74, .92], [.52, .93], [.42, 1], [.3, 1], [.14, 1.1], [.12, .98], [.02, .9],
  [-.1, .8], [-.02, .74], [-.13, .6], [-.06, .55], [-.12, .3], [-.1, 0]];
const DRAGON_HEAD_MINIMAL: Outline = [[.1, 0], [.2, .42], [.7, .64], [.4, .7], [.82, .86], [.45, .98], [.14, 1.1],
  [0, .9], [-.12, .55], [-.1, 0]];

const createDragonHead = (detailed: boolean) => {
  const shape = shapeOf(detailed ? DRAGON_HEAD : DRAGON_HEAD_MINIMAL);
  if (detailed) shape.holes.push(new Path([[.4, .835], [.45, .855], [.4, .875], [.35, .855]]
    .map(([x, y]) => new Vector2(x, y))));
  // Profile x (snout) becomes local +Z; the board thickness runs along X.
  return fitted("dragon-head", carvedProfile(shape, .2).rotateY(-Math.PI / 2));
};

/** Thins a blade from the socket to its cutting edge (a wedge rather than a slab). */
const taperBlade = (geometry: BufferGeometry, socket: number) => {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const reach = Math.max(0, Math.abs(position.getX(index)) - socket);
    position.setZ(index, position.getZ(index) * Math.max(.22, 1 - reach * .85));
  }
  geometry.computeVertexNormals();
  return geometry;
};

/** Bearded axe: straight top, long drooping beard, flared edge; socket at the origin, blade towards +x. */
const createBeardedAxeHead = (detailed: boolean) => {
  const shape = new Shape();
  shape.moveTo(-.16, .12); shape.lineTo(.12, .12);
  shape.quadraticCurveTo(.55, .14, 1, .32);
  shape.quadraticCurveTo(1.04, -.2, .84, -.76);
  shape.quadraticCurveTo(.45, -.5, .12, -.12);
  shape.lineTo(-.16, -.12); shape.closePath();
  return fitted("bearded-axe-head", taperBlade(carvedProfile(shape, .18, detailed ? 5 : 2), .1));
};

/** Two-bladed (double-bit) axe head: crescent edges both sides of a central socket. */
const createDoubleAxeHead = (detailed: boolean) => {
  const shape = new Shape();
  shape.moveTo(-.1, .13);
  shape.lineTo(.1, .13); shape.quadraticCurveTo(.5, .2, .82, .56);
  shape.quadraticCurveTo(1.06, 0, .82, -.56); shape.quadraticCurveTo(.5, -.2, .1, -.13);
  shape.lineTo(-.1, -.13); shape.quadraticCurveTo(-.5, -.2, -.82, -.56);
  shape.quadraticCurveTo(-1.06, 0, -.82, .56); shape.quadraticCurveTo(-.5, .2, -.1, .13);
  return fitted("double-axe-head", taperBlade(carvedProfile(shape, .18, detailed ? 5 : 2), .1));
};

/** The longship's round shield (stained planks, iron rim and boss), facing +Z; textured by its own material. */
const createRoundShield = (detailed: boolean) => fitted("round-shield", createVikingRoundShieldGeometry(detailed));

const BONE = [.86, .8, .66] as const;
const TINE_TIP = [.95, .92, .84] as const;

/** Red-deer antler: curved beam with brow, bez and crown tines, all in one plane (mirrors by turning). */
const createAntler = (detailed: boolean) => {
  const sculpt = createColouredSculpt(), sides = detailed ? 4 : 3, segments = detailed ? 3 : 2;
  const beam: SculptPoint[] = [[0, 0, 0], [.2, .22, 0], [.33, .52, 0], [.3, .84, 0], [.2, 1.02, 0]];
  const tint = (point: { y: number }) => point.y > .8 ? TINE_TIP : BONE;
  sculpt.add(taperedTube(curveThrough(beam), .05, .018, segments * 2, sides), tint);
  const tines: SculptPoint[][] = [[[.1, .1, 0], [.04, .26, 0], [-.03, .38, 0]], [[.3, .45, 0], [.42, .58, 0]],
    [[.31, .78, 0], [.44, .96, 0]]];
  for (const tine of detailed ? tines : tines.slice(0, 2))
    sculpt.add(taperedTube(curveThrough(tine), .026, .009, segments, sides), tint);
  if (detailed) sculpt.add(ellipsoid(5, [.06, .045, .05], [0, 0, 0]), BONE);
  const { max, min } = VIKING_ORNAMENT_BOXES.antler;
  return sculpt.build({ max, min });
};

const HULL = { dark: [.24, .16, .1], light: [.42, .29, .18] } as const;
const SAIL = [[.66, .12, .08], [.9, .86, .76]] as const;
const SHIELD_ROW = [[.66, .14, .09], [.82, .64, .22], [.9, .86, .76]] as const;

/** Longship hull side with a dragon stem and a curled stern, as a half-model carving (x along the ship). */
const LONGSHIP_HULL_MINIMAL: Outline = [[0, 0], [.42, .06], [.5, .34], [.56, .37], [.5, .41], [.43, .21], [0, .14],
  [-.43, .21], [-.44, .37], [-.515, .35], [-.47, .14], [-.42, .06]];
const LONGSHIP_HULL: Outline = [[0, 0], [.3, .012], [.42, .06], [.47, .14], [.49, .25], [.5, .34], [.56, .37],
  [.535, .41], [.47, .4], [.445, .31], [.425, .21], [.36, .16], [0, .14], [-.36, .16], [-.43, .21], [-.455, .3],
  [-.44, .37], [-.48, .39], [-.515, .35], [-.49, .3], [-.475, .24], [-.47, .14], [-.42, .06], [-.3, .012]];

/** Bulges the relief: deepest amidships, thin at the stem and stern posts. */
const bulgeHull = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index), depth = .012 + .05 * Math.max(0, 1 - (x / .46) ** 2);
    position.setZ(index, position.getZ(index) > .001 ? depth : 0);
  }
  return geometry;
};

/** Ship-shaped wall carving: hull strakes, a row of painted shields, mast, yard and striped sail. */
const createLongshipRelief = (detailed: boolean) => {
  const sculpt = createColouredSculpt();
  const hull = new ExtrudeGeometry(shapeOf(detailed ? LONGSHIP_HULL : LONGSHIP_HULL_MINIMAL), { bevelEnabled: false, curveSegments: 2, depth: 1 });
  sculpt.add(bulgeHull(hull), point => detailed && Math.floor(point.y / .035) % 2 ? HULL.light : HULL.dark);
  sculpt.add(new BoxGeometry(.014, .64, .014).translate(0, .45, .03), HULL.dark);
  sculpt.add(new BoxGeometry(.46, .016, .016).translate(0, .72, .034), HULL.dark);
  const stripes = detailed ? 6 : 1;
  for (let stripe = 0; stripe < stripes; stripe++) sculpt.add(new BoxGeometry(.4 / stripes, .36, .01)
    .translate(-.2 + (stripe + .5) * .4 / stripes, .52, .036), SAIL[stripes > 1 ? stripe % 2 : 0]!);
  const shields = detailed ? 7 : 0;
  for (let index = 0; index < shields; index++) sculpt.add(new CylinderGeometry(.03, .03, .012, 6).rotateX(Math.PI / 2)
    .translate(-.3 + index * .1, .155, .066), SHIELD_ROW[index % 3]!);
  const { max, min } = VIKING_ORNAMENT_BOXES["longship-relief"];
  return sculpt.build({ max, min });
};

/** Re-maps one box face's UVs (BoxGeometry: +x, -x, +y, -y, +z, -z; four vertices each) into a rectangle. */
const remapFaceUv = (geometry: BoxGeometry, face: number, rect: AtlasRect) => {
  const uv = geometry.getAttribute("uv");
  for (let index = face * 4; index < face * 4 + 4; index++)
    uv.setXY(index, rect[0] + (rect[2] - rect[0]) * uv.getX(index), rect[1] + (rect[3] - rect[1]) * uv.getY(index));
};

/** Carved field-stone plinth: a footing slab, a block with rune-carved faces and a moulded cap. */
const createRunePlinth = () => {
  const block = (width: number, height: number, depth: number, bottom: number, carved: boolean) => {
    const geometry = new BoxGeometry(width, height, depth);
    for (let face = 0; face < 6; face++)
      remapFaceUv(geometry, face, carved && face !== 2 && face !== 3 ? RUNE_PLINTH_ATLAS.face : RUNE_PLINTH_ATLAS.plain);
    return geometry.translate(0, bottom + height / 2, 0);
  };
  const parts = [block(.46, .06, .42, 0, false), block(.36, .22, .32, .06, true), block(.4, .035, .36, .28, false),
    block(.37, .015, .33, .315, false)];
  return fitted("rune-plinth", mergeGeometries(parts.map(part => {
    const flat = part.toNonIndexed();
    part.dispose();
    return flat;
  }), false)!);
};

/** Getter per shape, so each sculpt is only built when a recipe uses it. */
const BUILDERS: Readonly<Record<VikingOrnamentShape, (detailed: boolean) => BufferGeometry>> = {
  "antler": createAntler,
  "bearded-axe-head": createBeardedAxeHead,
  "double-axe-head": createDoubleAxeHead,
  "dragon-head": createDragonHead,
  "feather-wing": createFeatherWing,
  "longship-relief": createLongshipRelief,
  "round-shield": createRoundShield,
  "rune-plinth": createRunePlinth,
  "thor-statue": createVikingThorStatue,
  "viking-helmet": createVikingHelmet
};

export const isVikingOrnamentShape = (shape: string): shape is VikingOrnamentShape => shape in BUILDERS;

export const createVikingOrnamentGeometry = (shape: VikingOrnamentShape, detailed: boolean) =>
  BUILDERS[shape](detailed);
