import {
  BufferGeometry, CatmullRomCurve3, ConeGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, TubeGeometry,
  Vector3
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Point = readonly [number, number, number];
type Own = (geometry: BufferGeometry) => BufferGeometry;

/** Top of the swept stem the figurehead sits on (ship local, before the sailing-ship scale). */
const STEM_TOP: Point = [0, .43, 1.22];
/** Serpent neck from the stem head, arching up and forward to the skull. */
const NECK: readonly Point[] = [[0, .405, 1.205], [0, .48, 1.215], [0, .56, 1.25], [0, .6, 1.3], [0, .6, 1.335]];
const NECK_CURVE = new CatmullRomCurve3(NECK.map(point => new Vector3(...point)));
const HEAD_CENTRE: Point = [0, .598, 1.36];

/** Tube along `curve` whose radius tapers from `start` to `end`. */
const taperedTube = (curve: CatmullRomCurve3, start: number, end: number, segments: number, sides: number) => {
  const geometry = new TubeGeometry(curve, segments, 1, sides);
  const position = geometry.getAttribute("position"), centre = new Vector3(), vertex = new Vector3();
  for (let ring = 0; ring <= segments; ring++) {
    const t = ring / segments;
    curve.getPointAt(t, centre);
    const radius = start + (end - start) * t;
    for (let side = 0; side <= sides; side++) {
      const index = ring * (sides + 1) + side;
      vertex.fromBufferAttribute(position, index).sub(centre).multiplyScalar(radius).add(centre);
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
};

const ellipsoid = (
  segments: number, scale: Point, position: Point, pitch = 0
) => new SphereGeometry(1, segments, Math.max(4, segments - 2))
  .scale(...scale).rotateX(pitch).translate(...position);

const cone = (radius: number, height: number, sides: number, position: Point, tilt: Point) =>
  new ConeGeometry(radius, height, sides).rotateX(tilt[0]).rotateY(tilt[1]).rotateZ(tilt[2]).translate(...position);

const merged = (own: Own, parts: BufferGeometry[]) => {
  const plain = parts.map(part => {
    const flat = part.index ? part.toNonIndexed() : part;
    if (flat !== part) part.dispose();
    flat.deleteAttribute("uv");
    return flat;
  });
  const geometry = own(mergeGeometries(plain, false)!);
  plain.forEach(part => part.dispose());
  return geometry;
};

/** Carved neck with scale rings, skull, snout, open lower jaw, swept horns and a spined crest. */
const serpentWood = (detailed: boolean) => {
  const segments = detailed ? 10 : 6, sides = detailed ? 8 : 5;
  const parts: BufferGeometry[] = [
    taperedTube(NECK_CURVE, .036, .026, detailed ? 18 : 6, sides),
    ellipsoid(segments, [.04, .036, .062], HEAD_CENTRE, -.12),
    ellipsoid(segments, [.026, .022, .05], [0, .592, 1.41], -.2),
    ellipsoid(segments, [.022, .011, .052], [0, .556, 1.398], .32),
    cone(.011, .085, sides, [.024, .64, 1.322], [-1.15, 0, -.35]),
    cone(.011, .085, sides, [-.024, .64, 1.322], [-1.15, 0, .35])
  ];
  const crest = detailed ? 6 : 3;
  for (let index = 0; index < crest; index++) {
    const t = .15 + index / crest * .7, point = NECK_CURVE.getPointAt(t);
    parts.push(cone(.012, .05, 4, [0, point.y + .028, point.z - .022], [-.9, 0, 0]));
  }
  if (detailed) for (const t of [.25, .45, .65]) {
    const point = NECK_CURVE.getPointAt(t);
    parts.push(new TorusGeometry(.034 - t * .01, .0045, 4, 12).rotateX(Math.PI / 2 - t * 1.2)
      .translate(point.x, point.y, point.z));
  }
  return parts;
};

/** Red-painted gape and tongue, and the pale teeth along the jaws. */
const serpentPaint = (detailed: boolean) => {
  const parts: BufferGeometry[] = [
    ellipsoid(6, [.018, .006, .04], [0, .571, 1.404], .1),
    cone(.006, .07, 4, [0, .55, 1.455], [Math.PI / 2 + .55, 0, 0])
  ];
  return detailed ? parts : parts.slice(0, 1);
};
const serpentTeeth = () => [-.014, -.005, .005, .014].flatMap(x => [
  cone(.0035, .014, 3, [x, .581, 1.43 - Math.abs(x)], [Math.PI, 0, 0]),
  cone(.0035, .012, 3, [x, .565, 1.425 - Math.abs(x)], [0, 0, 0])
]);
const serpentEyes = () => [-1, 1].map(side => ellipsoid(6, [.009, .009, .009], [side * .03, .612, 1.38]));

/** A turned post continuing the stem, with a collar and a round finial. */
const stemPost = (detailed: boolean) => {
  const sides = detailed ? 10 : 6;
  return [
    new CylinderGeometry(.026, .032, .12, sides).translate(STEM_TOP[0], STEM_TOP[1] + .05, STEM_TOP[2]),
    new CylinderGeometry(.04, .04, .018, sides).translate(STEM_TOP[0], STEM_TOP[1] + .115, STEM_TOP[2]),
    ellipsoid(sides, [.033, .038, .033], [STEM_TOP[0], STEM_TOP[1] + .155, STEM_TOP[2]])
  ];
};

/** Raider serpent batches: carved wood, red paint, glowing eyes and (High only) bone teeth. */
export const createShipSerpentFigurehead = (detailed: boolean, own: Own) => ({
  eyes: merged(own, serpentEyes()),
  paint: merged(own, serpentPaint(detailed)),
  teeth: detailed ? merged(own, serpentTeeth()) : undefined,
  wood: merged(own, serpentWood(detailed))
});

/** Neutral ships' plain stem post. */
export const createShipStemPost = (detailed: boolean, own: Own) => merged(own, stemPost(detailed));
