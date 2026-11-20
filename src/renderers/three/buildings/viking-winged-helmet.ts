import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, SphereGeometry, TorusGeometry, Vector3 } from "three";

import { VIKING_ORNAMENT_BOXES } from "../../../render-common/buildings/viking-ornament-boxes";
import { createColouredSculpt, curveThrough, type SculptColor,taperedTube } from "../sculpt-geometry";
import { VIKING_HELMET_ATLAS as ATLAS } from "./viking-helmet-textures";

type Sculpt = ReturnType<typeof createColouredSculpt>;

const METAL = {
  bronze: [.84, .6, .32], iron: [.7, .7, .72], ironDark: [.62, .62, .65], leather: [.46, .29, .17],
  strip: [.55, .55, .58]
} as const satisfies Record<string, SculptColor>;

/** Dome of the cap: radius, height stretch and the brow band's top. */
const DOME = { base: .04, radius: .5, stretch: 1.12 } as const;

const domePoint = (theta: number, phi: number, radius: number) => new Vector3(-Math.cos(phi) * Math.sin(theta) * radius,
  Math.cos(theta) * radius * DOME.stretch + DOME.base, Math.sin(phi) * Math.sin(theta) * radius);

/**
 * A raised metal strip along a path (a flat top, bevelled sides); `outward` gives the surface normal
 * at each point. UVs run along the strip (rivet rows) and across it.
 */
const strip = (path: readonly Vector3[], outward: readonly Vector3[], width: number, lift: number) => {
  const profile = [[-1, 0], [-.85, 1], [.85, 1], [1, 0]] as const, positions: number[] = [], uvs: number[] = [];
  const indices: number[] = [], tangent = new Vector3(), side = new Vector3();
  path.forEach((point, index) => {
    tangent.subVectors(path[Math.min(index + 1, path.length - 1)]!, path[Math.max(index - 1, 0)]!).normalize();
    side.crossVectors(tangent, outward[index]!).normalize();
    for (const [across, up] of profile) {
      const vertex = point.clone().addScaledVector(side, across * width / 2).addScaledVector(outward[index]!, up * lift);
      positions.push(vertex.x, vertex.y, vertex.z); uvs.push(index / (path.length - 1), (across + 1) / 2);
    }
    if (index === path.length - 1) return;
    for (let face = 0; face < profile.length - 1; face++) {
      const a = index * profile.length + face, b = a + profile.length;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
};

/** A spangen strip over the dome from the crown down to the brow band, along the seam at `phi`. */
const spangen = (phi: number, steps: number) => {
  const path: Vector3[] = [], outward: Vector3[] = [];
  for (let step = 0; step <= steps; step++) {
    const theta = .04 + step / steps * (Math.PI / 2 - .12);
    path.push(domePoint(theta, phi, DOME.radius - .004));
    outward.push(domePoint(theta, phi, 1).setY(Math.cos(theta) / DOME.stretch).normalize());
  }
  return strip(path, outward, .085, .022);
};

/** Four riveted iron segments, a little different in tone, as in a spangenhelm. */
const cap = (sculpt: Sculpt, detailed: boolean) => {
  for (let segment = 0; segment < 4; segment++) {
    sculpt.add(new SphereGeometry(DOME.radius, detailed ? 5 : 2, detailed ? 7 : 3, segment * Math.PI / 2,
      Math.PI / 2, 0, Math.PI / 2).scale(1, DOME.stretch, 1).translate(0, DOME.base, 0),
    segment % 2 ? METAL.iron : METAL.ironDark, ATLAS.iron);
  }
  for (let segment = 0; segment < (detailed ? 4 : 2); segment++)
    sculpt.add(spangen(segment * Math.PI / 2 + (detailed ? 0 : Math.PI / 2), detailed ? 8 : 3), METAL.strip,
      ATLAS.rivets);
  if (detailed) sculpt.add(new SphereGeometry(.055, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)
    .translate(0, DOME.radius * DOME.stretch + DOME.base - .004, 0), METAL.bronze);
};

/** Bronze brow band in quarters (rivet rows round it) over a rolled leather lining. */
const browBand = (sculpt: Sculpt, detailed: boolean) => {
  for (let quarter = 0; quarter < 4; quarter++) sculpt.add(new CylinderGeometry(.522, .522, .14, detailed ? 6 : 3, 1,
    true, quarter * Math.PI / 2, Math.PI / 2).translate(0, .03, 0), METAL.bronze, ATLAS.rivets);
  if (!detailed) return;
  sculpt.add(new TorusGeometry(.508, .018, 3, 18).rotateX(Math.PI / 2).translate(0, -.042, 0), METAL.leather,
    ATLAS.rivets);
  for (let rivet = 0; rivet < 8; rivet++) {
    const angle = rivet * Math.PI / 4 + Math.PI / 8;
    sculpt.add(new SphereGeometry(.018, 4, 2, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).rotateY(angle).translate(Math.sin(angle) * .53, .03, Math.cos(angle) * .53),
      METAL.bronze);
  }
};

/** The nasal runs down from the band; High adds the spectacle guards round the eyes. */
const faceGuards = (sculpt: Sculpt, detailed: boolean) => {
  const path = [new Vector3(0, .08, .52), new Vector3(0, -.06, .535), new Vector3(0, -.18, .548),
    new Vector3(0, -.27, .555)];
  sculpt.add(strip(path, path.map(() => new Vector3(0, 0, 1)), .095, .03), METAL.strip, ATLAS.rivets);
  if (!detailed) return;
  for (const side of [-1, 1]) sculpt.add(taperedTube(curveThrough([[side * .04, -.03, .55], [side * .17, -.13, .5],
    [side * .29, -.07, .45], [side * .33, .0, .41]]), .02, .018, 8, 5), METAL.strip, ATLAS.iron);
};

/** Riveted bronze plates (High) on the temples with a socket each, where the wings or antlers are fixed. */
const sideMounts = (sculpt: Sculpt, detailed: boolean) => {
  for (const side of [-1, 1]) {
    if (detailed) sculpt.add(new CylinderGeometry(.075, .075, .03, 10).rotateZ(Math.PI / 2)
      .translate(side * .49, .18, 0), METAL.bronze, ATLAS.rivets);
    sculpt.add(new CylinderGeometry(.04, .046, .06, detailed ? 8 : 4).rotateZ(Math.PI / 2)
      .translate(side * .52, .18, 0), METAL.bronze);
  }
};

/**
 * Spangenhelm of riveted iron segments on a bronze brow band, with a nasal, spectacle guards (High),
 * a crown knob (High) and side mounts for its wings or antlers. Minimal keeps the same silhouette.
 */
export const createVikingHelmet = (detailed: boolean) => {
  const sculpt = createColouredSculpt();
  cap(sculpt, detailed);
  browBand(sculpt, detailed);
  faceGuards(sculpt, detailed);
  sideMounts(sculpt, detailed);
  const { max, min } = VIKING_ORNAMENT_BOXES["viking-helmet"];
  return sculpt.build({ max, min }, ATLAS.iron);
};

/** Width along a feather (0 at the quill, 1 at the tip): narrow quill, full vane, rounded tip. */
const featherWidth = (t: number) => {
  if (t < .1) return .35 + t / .1 * .65;
  if (t < .6) return 1;
  return .12 + .88 * Math.sqrt(Math.max(0, 1 - ((t - .6) / .4) ** 2));
};

interface Feather { angle: number; curl: number; length: number; width: number; z: number }

/**
 * One feather as a single curved vane (drawn double-sided): the trailing vane is wider than the
 * leading one, the shaft curls back a little and the vane cups slightly (less than the
 * spacing between layered feathers, so neighbours never cut through each other). +Y is the shaft before turning.
 */
const vane = ({ angle, curl, length, width, z }: Feather, steps: number, across: number) => {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [], columns = across * 2 + 1;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps, half = width * featherWidth(t) / 2;
    for (let column = 0; column < columns; column++) {
      const s = column / across - 1, reach = s < 0 ? .6 : 1;
      positions.push(curl * t * t * length + s * half * reach, t * length, Math.sin(t * Math.PI) * .003 +
        (1 - Math.abs(s)) * .0015);
      uvs.push((s + 1) / 2, t);
      if (step < steps && column < columns - 1) {
        const a = step * columns + column, b = a + columns;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry.rotateZ(angle - Math.PI / 2).translate(0, 0, z);
};

const PLUMAGE = { covert: [.92, .9, .85], primary: [.95, .94, .91], secondary: [.84, .83, .8], tip: [.5, .47, .44] } as
  const satisfies Record<string, SculptColor>;

/**
 * Fans `count` feathers from `from` to `to` radians, lengths easing from `longest` to `shortest`;
 * `layer` sets each one's depth, so overlapping feathers lie on one another instead of z-fighting.
 */
const fan = (count: number, from: number, to: number, longest: number, shortest: number, width: number,
  layer: (k: number) => number) =>
  Array.from({ length: count }, (_, index): Feather => {
    const k = count > 1 ? index / (count - 1) : 0;
    return { angle: from + (to - from) * k, curl: -.12, length: longest + (shortest - longest) * k * k, width,
      z: layer(k) };
  });

/**
 * Valkyrie wing in three layers: long dark-tipped primaries, then secondaries and short coverts on
 * both faces (the left wing is the right one turned over), all bound in a bronze cuff with leather
 * lashing that seats in the helmet's side socket.
 */
export const createFeatherWing = (detailed: boolean) => {
  const sculpt = createColouredSculpt(), steps = detailed ? 6 : 3, across = detailed ? 2 : 1;
  const layers: readonly (readonly [Feather[], SculptColor])[] = [
    [fan(detailed ? 7 : 6, .22, 1.34, .98, .64, .28, k => (k - .5) * .03), PLUMAGE.primary],
    ...[-1, 1].map(face => [fan(detailed ? 5 : 4, .32, 1.24, .64, .46, .26, k => face * (.022 + k * .004)),
      PLUMAGE.secondary] as const),
    ...(detailed ? [-1, 1].map(face => [fan(4, .42, 1.14, .36, .28, .22, k => face * (.034 + k * .002)),
      PLUMAGE.covert] as const) : [])
  ];
  for (const [feathers, colour] of layers) for (const feather of feathers) {
    const tipFrom = feather.length * .86;
    sculpt.add(vane(feather, steps, across), point => Math.hypot(point.x, point.y) > tipFrom && colour === PLUMAGE.primary
      ? PLUMAGE.tip : colour, ATLAS.feather);
  }
  sculpt.add(new CylinderGeometry(.04, .052, .16, detailed ? 8 : 4).rotateZ(Math.PI / 2).translate(.02, .02, 0),
    METAL.bronze, ATLAS.rivets);
  if (detailed) for (const x of [-.025, .065]) sculpt.add(new TorusGeometry(.05, .009, 4, 10).rotateY(Math.PI / 2)
    .translate(x, .02, 0), METAL.leather);
  const { max, min } = VIKING_ORNAMENT_BOXES["feather-wing"];
  return sculpt.build({ max, min }, ATLAS.feather);
};
