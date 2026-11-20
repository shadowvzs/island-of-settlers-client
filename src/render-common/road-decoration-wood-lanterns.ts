import { type AddRoadPart, roadDecorationAdder, type RoadDecorationPart } from "./road-decoration-recipe";

const CEDAR: [number, number, number] = [.81, .64, .41];
const LACQUER: [number, number, number] = [.47, .24, .12];

const addLanternBrace = (add: AddRoadPart, from: [number, number, number], to: typeof from) => {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], length = Math.hypot(dx, dy, dz);
  // The renderer applies X, then Y, then Z: align local Y to the actual joined endpoints.
  add({ shape: "box", position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    rotation: [Math.acos(dy / length), Math.atan2(dx, dz), 0], size: [.008, length, .009],
    surface: "wood", tint: LACQUER });
};

/** Distinct timber lanterns: square cedar paper chamber versus hexagonal tiered pavilion. */
export const createWoodenRoadLanternRecipe = (nation: "japanese" | "chinese", detailed: boolean) => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts), japanese = nation === "japanese";
  if (japanese) {
    add({ shape: "bevel-box", position: [0, .035, 0], size: [.24, .07, .24], surface: "wood", tint: CEDAR });
    add({ shape: "bevel-box", position: [0, .34, 0], size: [.075, .61, .075], surface: "planks", tint: CEDAR });
    for (const y of [.12, .57]) add({ shape: "bevel-box", position: [0, y, 0], size: [.10, .04, .10],
      surface: "wood", tint: [.43, .34, .23] });
    for (const y of [.66, .96]) add({ shape: "bevel-box", position: [0, y, 0], size: [.23, .045, .23],
      surface: "wood", tint: CEDAR });
    for (const x of [-.092, .092]) for (const z of [-.092, .092]) add({ shape: "bevel-box",
      position: [x, .81, z], size: [.025, .29, .025], surface: "wood", tint: CEDAR });
    for (const side of [-1, 1]) {
      add({ shape: "box", position: [0, .81, side * .094], size: [.16, .24, .004],
        surface: "cloth", tint: [.97, .93, .79] });
      add({ shape: "box", position: [side * .094, .81, 0], size: [.004, .24, .16],
        surface: "cloth", tint: [.97, .93, .79] });
      for (const y of detailed ? [.74, .81, .88] : [.81]) {
        add({ shape: "box", position: [0, y, side * .099], size: [.17, .009, .008], surface: "wood", tint: CEDAR });
        add({ shape: "box", position: [side * .099, y, 0], size: [.008, .009, .17], surface: "wood", tint: CEDAR });
      }
    }
    parts.push({ kind: "lantern-roof", position: [0, .99, 0], size: [.30, .13, .30], surface: "wood", tint: CEDAR });
    for (const x of [-.092, .092]) for (const z of [-.092, .092])
      add({ shape: "box", position: [x, .998, z], size: [.025, .036, .025], surface: "wood", tint: CEDAR });
    add({ shape: "bevel-box", position: [0, 1.135, 0], size: [.055, .035, .055], surface: "wood", tint: CEDAR });
  } else {
    for (const [y, width, height] of [[.035, .24, .07], [.10, .16, .06], [.33, .085, .43], [.57, .24, .055], [.90, .24, .055]] as const)
      add({ shape: "cylinder", position: [0, y, 0], size: [width, height, width], radialSegments: 6,
        surface: "wood", tint: LACQUER });
    for (let face = 0; face < 6; face++) {
      const angle = face * Math.PI / 3, x = Math.sin(angle) * .095, z = Math.cos(angle) * .095;
      add({ shape: "cylinder", position: [x, .735, z], size: [.018, .30, .018], radialSegments: detailed ? 6 : 3,
        surface: "wood", tint: LACQUER });
      const panelAngle = angle + Math.PI / 6, px = Math.sin(panelAngle) * .077, pz = Math.cos(panelAngle) * .077;
      add({ shape: "box", position: [px, .735, pz], rotation: [0, panelAngle, 0], size: [.074, .24, .004],
        surface: "amber", tint: [.96, .81, .57] });
      const next = angle + Math.PI / 3;
      addLanternBrace(add, [x, .60, z], [Math.sin(next) * .095, .87, Math.cos(next) * .095]);
      if (detailed) addLanternBrace(add, [Math.sin(next) * .095, .60, Math.cos(next) * .095], [x, .87, z]);
    }
    for (const [y, width, height] of [[.97, .30, .12], [1.075, .215, .09]] as const)
      add({ shape: "cone", position: [0, y, 0], size: [width, height, width], topScale: [.25, 1, .25],
        radialSegments: 6, surface: "planks", tint: LACQUER });
    add({ shape: "cylinder", position: [0, 1.03, 0], size: [.05, .12, .05], radialSegments: 6,
      surface: "wood", tint: LACQUER });
    add({ shape: "cylinder", position: [0, 1.025, 0], size: [.078, .018, .078], radialSegments: 6,
      surface: "wood", tint: LACQUER });
    add({ shape: "sphere", position: [0, 1.145, 0], size: [.045, .065, .045], radialSegments: detailed ? 8 : 4,
      surface: "wood", tint: LACQUER });
  }
  return { definition: { id: `${nation}-wooden-lantern` }, parts, wind: 0 as const };
};
