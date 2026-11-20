import { createClimberPendantComposition, sampleClimberShoot } from "./road-climber-composition";
import { roadDecorationAdder, type RoadDecorationPart, roadProfileBeam } from "./road-decoration-recipe";
import { addWisteriaClimber, wisteriaLimb } from "./road-decoration-wisteria-botany";

export type WisteriaRoadFrame = "curved" | "lattice" | "pergola";
/** Explicit premium hand-placed asset ceilings; native population cost still needs acceptance. */
export const WISTERIA_TRIANGLE_BUDGET = Object.freeze({ high: 9000, minimal: 2300 });
/** Colour is a material/instance choice, never part of the frame/raceme geometry cache key. */
export const WISTERIA_PALETTES = Object.freeze({ purple: [.60, .36, .86], lilac: [.79, .65, .95],
  white: [.99, .97, .91], pink: [.96, .65, .80], blue: [.45, .63, .95] } as const);
const WOOD: [number, number, number] = [.64, .45, .27];
const post = 1.18;
const topAt = (frame: WisteriaRoadFrame, x: number) => frame === "curved" ? 3.35 - .55 * (Math.abs(x) / 1.3) ** 3 : 2.95;

const compoundLeaf = (parts: RoadDecorationPart[], x: number, y: number, z: number, yaw: number, detailed: boolean) => {
  const add = roadDecorationAdder(parts), pairs = detailed ? 3 : 2;
  add({ shape: "cylinder", position: [x, y, z], size: [.008, .46, .008], rotation: [Math.PI / 2, 0, -yaw],
    radialSegments: 3, surface: "leaf", tint: [.09, .20, .035] });
  for (let pair = 0; pair < pairs; pair++) for (const side of [-1, 1]) {
    const along = -.17 + pair * .13;
    parts.push({ kind: detailed ? "botanical-leaf" : "folded-leaf", position: [x + Math.sin(yaw) * along + Math.cos(yaw) * side * .08,
      y - pair * .012, z + Math.cos(yaw) * along - Math.sin(yaw) * side * .08],
    rotation: [.30 + pair * .12, yaw + side * .65, side * .15], size: [.12, .018, .23],
    surface: "leaf", tint: [.13 + pair * .02, .33 + pair * .025, .055] });
  }
  parts.push({ kind: detailed ? "botanical-leaf" : "folded-leaf", position: [x + Math.sin(yaw) * .24, y - .025, z + Math.cos(yaw) * .24],
    rotation: [.5, yaw, .1], size: [.115, .018, .22], surface: "leaf", tint: [.20, .37, .10] });
};

/** Isolated, unregistered prototypes. Two rooted vines, connected joinery and compound leaves surround a clear passage. */
export const createWisteriaRoadRecipe = (frame: WisteriaRoadFrame, detailed: boolean) => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts), top = topAt(frame, post);
  for (const side of [-1, 1]) {
    add({ shape: "bevel-box", position: [side * post, top / 2, 0], size: [.15, top, .15], surface: "wood", tint: WOOD });
    addWisteriaClimber(parts, side, post, top, detailed);
    for (let node = 0; node < (detailed ? 4 : 2); node++) {
      const y = .65 + node * (detailed ? .48 : .95), x = side * (post + .13);
      wisteriaLimb(parts, [side * post, y - .12, .10], [x, y, .21], .018, .008, detailed);
      compoundLeaf(parts, x, y, .21, side * .7 + node, detailed);
    }
    if (frame === "lattice") for (const z of [-.25, .25]) for (let row = 0; row < (detailed ? 5 : 3); row++) {
      const y = .35 + row * (detailed ? .42 : .70);
      roadProfileBeam(add, [side * (post - .13), y, z], [side * (post + .13), y + .30, z], .025, .025, "wood", WOOD, false);
      roadProfileBeam(add, [side * (post + .13), y, z], [side * (post - .13), y + .30, z], .025, .025, "wood", WOOD, false);
    }
  }
  for (const z of [-.22, .22]) {
    if (frame === "curved") parts.push({ kind: "swept-beam", position: [0, 3.35, z], size: [2.6, .13, .12],
      sweep: -.55, profileSegments: detailed ? 12 : 8, surface: "wood", tint: WOOD });
    else add({ shape: "bevel-box", position: [0, top, z], size: [2.65, .14, .11], surface: "wood", tint: WOOD });
  }
  const slats = (detailed ? { pergola: 9, curved: 5, lattice: 5 } : { pergola: 5, curved: 3, lattice: 3 })[frame];
  for (let index = 0; index < slats; index++) {
    const x = -1.18 + index / (slats - 1) * 2.36, y = topAt(frame, x);
    add({ shape: "box", position: [x, y + .06, 0], size: [.055, .07, .66], surface: "wood", tint: WOOD });
  }
  const canopySegments = detailed ? 8 : 4, canes = new Map<number, [number, number, number][]>();
  for (const z of [-.29, .29]) {
    const points = Array.from({ length: canopySegments + 1 }, (_, index): [number, number, number] => {
      const x = -post + index / canopySegments * post * 2;
      return [x, topAt(frame, x) + .075, z];
    });
    for (let index = 1; index < points.length; index++)
      wisteriaLimb(parts, points[index - 1]!, points[index]!, .043, .035, detailed);
    canes.set(Math.sign(z), points);
  }
  const seed = { curved: 47, lattice: 193, pergola: 619 }[frame];
  const composition = createClimberPendantComposition(8, seed,
    (at, side) => sampleClimberShoot(canes.get(side)!, at));
  for (const shoot of composition.shoots)
    for (let segment = 1; segment < shoot.points.length; segment++)
      wisteriaLimb(parts, [...shoot.points[segment - 1]!], [...shoot.points[segment]!], .018, .009, detailed);
  let canopyLeaves = frame === "pergola" ? 10 : 6;
  if (detailed) canopyLeaves = 14;
  for (let index = 0; index < canopyLeaves; index++) {
    const shoot = composition.shoots[index % composition.shoots.length]!;
    const layer = Math.floor(index / composition.shoots.length);
    const point = sampleClimberShoot(shoot.points, .18 + layer * .21);
    compoundLeaf(parts, point[0], point[1], point[2], index * 2.39996, detailed);
  }
  for (const site of composition.sites) {
    const origin: [number, number, number] = [site.attachment[0], site.attachment[1] - site.neck, site.attachment[2]];
    const dx = Math.sin(site.tilt) * site.length, dy = Math.cos(site.tilt) * site.length;
    const bottom: [number, number, number] = [origin[0] + dx, origin[1] - dy, origin[2]];
    wisteriaLimb(parts, [...site.attachment], origin, .007, .006, detailed);
    wisteriaLimb(parts, origin, bottom, .007, .004, detailed);
    parts.push({ kind: "wisteria-raceme", position: [origin[0] + dx / 2, origin[1] - dy / 2, origin[2]],
      size: [.45, site.length, .45], rotation: [0, site.yaw, site.tilt], surface: "paint", tint: [1, 1, 1] });
  }
  return { definition: { id: `wisteria-${frame}` }, parts, wind: 0 as const, botany: composition };
};
