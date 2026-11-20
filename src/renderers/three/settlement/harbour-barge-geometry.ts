import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from "three";

import { LIGHTER_BEAM, LIGHTER_LENGTH } from "../../../render-common/ships/lighter-dimensions";

/**
 * Harbour lighter barge (NAV-03 art pass, owner 2026-10-20): a small planked rowing barge, in tiles, bow along
 * +z. The hull is lofted from stations (pointed bow, narrow transom stern, rocker and sheer) with each strake its
 * own plank shade; gunwale rails, two thwarts, floorboards and a stem post. Rowers sit on the thwarts facing the
 * stern. Flat-shaded triangle soups with vertex colours, one material per barge.
 */
/** The transom keeps this share of the beam at the stern. */
const TRANSOM_SHARE = .42;
const KEEL_Y = -.1;
export const BARGE_DRY_FLOOR_Y = .12;
const GUNWALE_Y = .3;
const SHEER_RISE = .14;
const RAIL_WIDTH = .06;
/** One stern rowing thwart; the middle/bow stay available for cargo or ferry passengers. */
export const SEAT_Y = .17;
export const ROWER_SEATS = [-.5] as const;
// Locks beside the knees match the actual population skeleton's reach.
const OARLOCK_AHEAD = .1;

const PLANK_LIGHT = 0x9a7853;
const PLANK_DARK = 0x7f6142;
const RAIL = 0x4a3524;
const THWART = 0xa07c55;
const FLOOR = 0x5f4732;
const OAR = 0xb08a5e;
type Point = readonly [number, number, number];

/** Collects coloured triangles; `geometry()` returns them flat-shaded. */
const createSoup = () => {
  const positions: number[] = [], colors: number[] = [];
  const triangle = (a: Point, b: Point, c: Point, hex: number) => {
    const tint = new Color(hex);
    for (const point of [a, b, c]) { positions.push(...point); colors.push(tint.r, tint.g, tint.b); }
  };
  const quad = (a: Point, b: Point, c: Point, d: Point, hex: number) => {
    triangle(a, b, c, hex); triangle(a, c, d, hex);
  };
  const geometry = () => {
    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute(positions, 3));
    result.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const uv: number[] = [];
    for (let i = 0; i < positions.length; i += 3) uv.push(positions[i + 2]! * .42,
      positions[i + 1]! * 1.4 + positions[i]! * .12);
    result.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    result.computeVertexNormals();
    return result;
  };
  return { geometry, quad, triangle };
};
type Soup = ReturnType<typeof createSoup>;

/** A tapered prism from `from` to `to` (`sides` faces, no end caps unless `cap`). */
const prism = (soup: Soup, from: Point, to: Point, radii: readonly [number, number], sides: number, hex: number,
  cap = false) => {
  const axis = new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
  const side = new Vector3(0, 1, 0).cross(axis);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up = axis.clone().cross(side).normalize();
  const ring = (centre: Point, radius: number) => Array.from({ length: sides }, (_, index) => {
    const angle = index / sides * Math.PI * 2, x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    return [centre[0] + side.x * x + up.x * y, centre[1] + side.y * x + up.y * y,
      centre[2] + side.z * x + up.z * y] as const;
  });
  const start = ring(from, radii[0]), end = ring(to, radii[1]);
  for (let index = 0; index < sides; index++) {
    const next = (index + 1) % sides;
    soup.quad(start[index]!, start[next]!, end[next]!, end[index]!, hex);
    if (cap) soup.triangle(to, end[index]!, end[next]!, hex);
  }
};

/** Half-beam, keel and gunwale height at `share` of the length from the stern (0) to the bow (1). */
const station = (share: number) => {
  const fromMiddle = Math.abs(share * 2 - 1);
  const fine = 1 - fromMiddle ** 2.4;
  const halfBeam = LIGHTER_BEAM / 2 * (share < .5 ? Math.max(TRANSOM_SHARE, fine) : fine);
  return { halfBeam, keel: KEEL_Y + .1 * fromMiddle ** 2, top: GUNWALE_Y + SHEER_RISE * fromMiddle ** 2,
    z: (share - .5) * LIGHTER_LENGTH };
};
/** A point of the hull section: `strake` share from the keel (0) round the bilge to the gunwale (1). */
const sectionPoint = (share: number, strake: number, side: number): Point => {
  const { halfBeam, keel, top, z } = station(share);
  return [side * halfBeam * Math.sin(Math.min(1, strake * 1.35) * Math.PI / 2), keel + (top - keel) * strake ** 1.5,
    z];
};

/** Hull, rails, thwarts, floor and stem: High has three strakes and ten stations, Minimal two and six. */
export const buildBargeHull = (detailed: boolean, dryFloor = false) => {
  const soup = createSoup(), strakes = detailed ? 3 : 2, stations = detailed ? 10 : 6;
  for (const side of [1, -1]) for (let index = 0; index < stations - 1; index++) {
    const aft = index / (stations - 1), fore = (index + 1) / (stations - 1);
    for (let strake = 0; strake < strakes; strake++) {
      const low = strake / strakes, high = (strake + 1) / strakes;
      const points = [sectionPoint(aft, low, side), sectionPoint(fore, low, side), sectionPoint(fore, high, side),
        sectionPoint(aft, high, side)] as const;
      const shade = strake % 2 ? PLANK_DARK : PLANK_LIGHT;
      if (side > 0) soup.quad(points[0], points[1], points[2], points[3], shade);
      else soup.quad(points[0], points[3], points[2], points[1], shade);
    }
    if (!detailed) continue;
    // The gunwale rail: a cap a little wider than the planking along the top edge.
    const railAft = sectionPoint(aft, 1, side), railFore = sectionPoint(fore, 1, side);
    const out = (point: Point): Point => [point[0] + side * RAIL_WIDTH, point[1] + .02, point[2]];
    const inner = (point: Point): Point => [point[0] - side * RAIL_WIDTH * .5, point[1] + .02, point[2]];
    if (side > 0) soup.quad(inner(railAft), inner(railFore), out(railFore), out(railAft), RAIL);
    else soup.quad(inner(railAft), out(railAft), out(railFore), inner(railFore), RAIL);
    // Close the gap between each raised rail cap and the actual planked hull edge.
    soup.quad(railAft, railFore, out(railFore), out(railAft), RAIL);
    soup.quad(inner(railAft), inner(railFore), railFore, railAft, RAIL);
  }
  // The transom: the stern's flat board.
  for (let strake = 0; strake < strakes; strake++) {
    const low = strake / strakes, high = (strake + 1) / strakes;
    soup.quad(sectionPoint(0, low, -1), sectionPoint(0, high, -1), sectionPoint(0, high, 1), sectionPoint(0, low, 1),
      strake % 2 ? PLANK_DARK : PLANK_LIGHT);
  }
  const floor = KEEL_Y + .05;
  if (dryFloor) {
    // A visible sole above the water shader, fitted to the same hull sections. The submerged keel
    // remains unchanged; a flat rectangular cover would protrude through the narrow raised ends.
    const floorPoint = (share: number, side: number): Point => {
      const section = station(share), y = Math.max(BARGE_DRY_FLOOR_Y, section.keel + .02);
      const strake = ((y - section.keel) / (section.top - section.keel)) ** (2 / 3);
      const half = section.halfBeam * Math.sin(Math.min(1, strake * 1.35) * Math.PI / 2) * .98;
      return [side * half, y, section.z];
    };
    for (let index = 0; index < stations - 1; index++) {
      const aft = index / (stations - 1), fore = (index + 1) / (stations - 1);
      soup.quad(floorPoint(aft, -1), floorPoint(aft, 1), floorPoint(fore, 1), floorPoint(fore, -1),
        index % 2 ? FLOOR : PLANK_DARK);
    }
  } else soup.quad([-.22, floor, -.95], [.22, floor, -.95], [.22, floor, .95], [-.22, floor, .95], FLOOR);
  // One operator thwart; the ferry adds its passenger bench only while it is occupied.
  for (const seat of ROWER_SEATS) {
    const half = station(seat / LIGHTER_LENGTH + .5).halfBeam - .03;
    prism(soup, [-half, SEAT_Y - .02, seat], [half, SEAT_Y - .02, seat], [.06, .06], 4, THWART);
  }
  if (!detailed) return soup.geometry();
  const bow = station(1);
  prism(soup, [0, bow.keel, bow.z - .02], [0, bow.top + .12, bow.z + .02], [.035, .03], 4, RAIL, true);
  return soup.geometry();
};

/** An oar along +z from its handle (0) to its blade tip (1), unit length: the shaft and the flat blade. */
export const buildOar = (detailed: boolean, handleRadius = .022, handleExtension = 0) => {
  const soup = createSoup();
  prism(soup, [0, 0, -handleExtension], [0, 0, .78], [handleRadius, .016], detailed ? 4 : 3, OAR);
  soup.quad([-.055, 0, .7], [.055, 0, .7], [.055, 0, 1], [-.055, 0, 1], OAR);
  return soup.geometry();
};

/** Ladder from a lighter to a sea-ship deck. */
export const buildLadder = () => {
  const soup = createSoup();
  for (const side of [1, -1]) prism(soup, [side * .16, 0, 0], [side * .16, 1, 0], [.022, .022], 4, RAIL);
  for (let rung = 1; rung <= 5; rung++) prism(soup, [-.16, rung / 6, 0], [.16, rung / 6, 0], [.015, .015], 4, THWART);
  return soup.geometry();
};
/** Where a rower's oar pair pivots: on the gunwale just ahead of his seat (towards the stern). */
export const oarlockOf = (seat: number, side: number) => {
  const z = seat - OARLOCK_AHEAD, at = station(z / LIGHTER_LENGTH + .5);
  return new Vector3(side * at.halfBeam, at.top + .03, z);
};
