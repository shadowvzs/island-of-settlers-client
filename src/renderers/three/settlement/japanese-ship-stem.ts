import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, type Group, Vector3 } from "three";

import { type HullForm,hullPoint } from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";

/** Forward rake of the stem at the bulwark top, in ship units. */
const STEM_RAKE = .17;
/** The planking starts leaning into the stem curve here (t) and follows it fully at the bow. */
const RAKE_FROM = .74;
/** The stem timber follows the keel line aft from the forefoot to here (t). */
const FOREFOOT_FROM = .8;
/** Sections (a) the stem rises through, keel to bulwark; the head stands this far above the bulwark. */
const STEM_SECTIONS = [1, .75, .5, .25, 0] as const;
const HEAD_RISE = .07;

/** The stem curve's forward offset at section `a`: it sweeps forward off the forefoot, then rises raked. */
const stemCurve = (a: number, top: number) => {
  const u = (1 - a) / (1 - top);
  return STEM_RAKE * (.6 * u + .4 * (1 - (1 - u) ** 3));
};

/** The hull's rake: the bow planking closes onto one smoothly curving stem (top: the bulwark section). */
export const stemRake = (top: number) => (t: number, a: number) =>
  t <= RAKE_FROM ? 0 : ((t - RAKE_FROM) / (1 - RAKE_FROM)) ** 2 * stemCurve(a, top);

/** Corners of the timber section (across, outwards), wound so that each face looks outwards. */
const SECTION_CORNERS = [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const;

/** A timber section: depth before (`front`, away from the hull) and behind (`back`) the curve. */
interface TimberSection { back: number; front: number; halfWidth: number }
/** The stretch of the curve (arc-length fractions) a timber covers, sampled at `stations` + 1 points. */
interface TimberSpan { from: number; stations: number; to: number }

const STEM_SECTION: TimberSection = { back: .04, front: .028, halfWidth: .032 };
/** The lacquer cap sheathes the stem head from just below the rails, standing this much proud. */
const CAP_LENGTH = .055;
const CAP_PROUD = .005;

const enlarged = ({ back, front, halfWidth }: TimberSection, proud: number): TimberSection =>
  ({ back: back + proud, front: front + proud, halfWidth: halfWidth + proud });

/** Unit normal of the centre-plane curve at `u`, pointing away from the hull. */
const outwardNormal = (curve: CatmullRomCurve3, u: number) => {
  const { y, z } = curve.getTangentAt(u);
  return new Vector3(0, -z, y).normalize();
};

/** A squared timber swept along a curve in the ship's centre plane: flat faces, smooth along its length. */
const sweptTimber = (curve: CatmullRomCurve3, { from, stations, to }: TimberSpan,
  { back, front, halfWidth }: TimberSection) => {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [], length = curve.getLength();
  SECTION_CORNERS.forEach((_, face) => {
    const start = positions.length / 3;
    for (let station = 0; station <= stations; station++) {
      const u = from + (to - from) * station / stations, point = curve.getPointAt(u);
      const normal = outwardNormal(curve, u);
      for (const [across, out] of [SECTION_CORNERS[face]!, SECTION_CORNERS[(face + 1) % 4]!]) {
        const depth = out > 0 ? front : -back;
        positions.push(across * halfWidth, point.y + normal.y * depth, point.z + normal.z * depth);
        uvs.push(u * length * 2, (face + (out > 0 ? 0 : 1)) * .1);
      }
      if (station === stations) continue;
      const a = start + station * 2, next = a + 2;
      indices.push(a, a + 1, next, a + 1, next + 1, next);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};

/** The stem line: along the keel from the forefoot, up the raked bow and on to the stem head. */
const stemCurvePath = (form: HullForm, top: number) => {
  const keel = [FOREFOOT_FROM, (FOREFOOT_FROM + 1) / 2].map(t => hullPoint(form, t, 1, 0));
  const rise = [...STEM_SECTIONS, top, top - HEAD_RISE].map(a => hullPoint(form, 1, a, 0));
  return new CatmullRomCurve3([...keel, ...rise].map(([x, y, z]) => new Vector3(x, y, z)), false, "centripetal");
};

/** The lacquer board closing the top of the cap, square to the stem. */
const addCapTop = (kit: ShipKit, planking: Group, curve: CatmullRomCurve3) => {
  const { back, front, halfWidth } = enlarged(STEM_SECTION, CAP_PROUD * 2);
  const point = curve.getPointAt(1), normal = outwardNormal(curve, 1), tangent = curve.getTangentAt(1);
  const shift = (front - back) / 2, thickness = .014;
  const board = kit.add(planking, "lacquer", [halfWidth * 2, thickness, back + front], [0,
    point.y + normal.y * shift + tangent.y * thickness / 2, point.z + normal.z * shift + tangent.z * thickness / 2]);
  board.rotation.x = Math.atan2(tangent.z, tangent.y);
};

/**
 * One continuous bow timber (misaoshi) rising from the keel at the forefoot: the side planks close onto
 * its back, the vermilion rails end in it, and a black lacquer cap sheathes its head (High: a gilt band
 * at the cap's foot).
 */
export const addJapaneseStem = (kit: ShipKit, planking: Group, form: HullForm, top: number) => {
  const curve = stemCurvePath(form, top), capFrom = 1 - CAP_LENGTH / curve.getLength();
  const timber = { from: 0, stations: kit.detailed ? 18 : 8, to: capFrom };
  kit.mesh(planking, "wood", kit.temp(sweptTimber(curve, timber, STEM_SECTION)));
  const cap = { from: capFrom - .01, stations: kit.detailed ? 3 : 1, to: 1 };
  kit.mesh(planking, "lacquer", kit.temp(sweptTimber(curve, cap, enlarged(STEM_SECTION, CAP_PROUD))));
  addCapTop(kit, planking, curve);
  if (!kit.detailed) return;
  const band = { from: capFrom - .025, stations: 1, to: capFrom - .005 };
  kit.mesh(planking, "gold", kit.temp(sweptTimber(curve, band, enlarged(STEM_SECTION, CAP_PROUD * 2))));
};
