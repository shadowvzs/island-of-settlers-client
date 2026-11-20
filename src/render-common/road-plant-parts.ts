import type { Point3 } from "./buildings/building-recipe";
import { roadDecorationAdder, type RoadDecorationPart } from "./road-decoration-recipe";
import type { RoadPlantColour } from "./road-plant-catalog";

export interface RoadPlantBuilder {
  parts: RoadDecorationPart[];
  detailed: boolean;
  seed: number;
  flowerColour?: RoadPlantColour;
}

export const plantNoise = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export const plantBranch = (builder: RoadPlantBuilder, from: Point3, to: Point3, width: number) => {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const horizontal = Math.hypot(dx, dz);
  roadDecorationAdder(builder.parts)({ shape: "cylinder",
    position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    rotation: [Math.atan2(horizontal, dy), Math.atan2(dx, dz), 0],
    size: [width, Math.hypot(horizontal, dy) + .004, width], topScale: [.72, 1, .72],
    radialSegments: builder.detailed ? 9 : 5, surface: "bark", tint: [.86, .77, .62] });
};

/** Closed folded leaves retain volume from either side; no alpha cards or wind shader are required. */
export const plantLeaf = (builder: RoadPlantBuilder, position: Point3, yaw: number,
  length: number, width: number, colour: RoadPlantColour, index: number) => {
  const shade = .88 + plantNoise(index + builder.seed) * .24;
  builder.parts.push({ kind: "botanical-leaf", position,
    rotation: [.25 + plantNoise(index * 3) * .65, yaw, (plantNoise(index * 7) - .5) * .6],
    size: [width, length * .10, length], surface: "leaf",
    tint: [colour[0] ** 2.2 * shade, colour[1] ** 2.2 * shade, colour[2] ** 2.2 * shade] });
};

export const plantFlower = (builder: RoadPlantBuilder, position: Point3, colour: RoadPlantColour,
  radius: number, index: number) => {
  builder.flowerColour = colour;
  const petals = builder.detailed ? 5 : 4;
  for (let petal = 0; petal < petals; petal++) {
    const angle = petal * Math.PI * 2 / petals + index;
    builder.parts.push({ kind: "botanical-leaf", position: [position[0] + Math.sin(angle) * radius * .45,
      position[1] + Math.sin(angle) * radius * .2, position[2] + Math.cos(angle) * radius * .45],
    rotation: [.35 + Math.sin(index) * .35, angle, .25],
    size: [radius * .95, radius * .14, radius * 1.35], surface: "paint",
    tint: [1, 1, 1] });
  }
  roadDecorationAdder(builder.parts)({ shape: "sphere", position: [position[0], position[1] + .006, position[2]],
    size: [radius * .32, radius * .22, radius * .32], radialSegments: 4,
    surface: "paint", tint: [.92, .70, .23] });
};

/** Three genuinely different ceramic bodies, each with a broad planar bearing foot and open soil top. */
export const plantCeramicPot = (builder: RoadPlantBuilder, variant: number, bonsai = false): number => {
  const add = roadDecorationAdder(builder.parts), radius = .18;
  let height = .29 + variant * .035;
  if (bonsai) height = .11 + variant * .025;
  const colours: RoadPlantColour[] = [[.65, .35, .20], [.29, .51, .50], [.72, .63, .44]];
  const tint = colours[variant]!;
  const levels: Array<[number, number]> = [[.02, .115], [height * .25, .13], [height * .55, radius - variant * .012],
    [height - .04, radius], [height, radius + .012]];
  const segments = builder.detailed ? 16 : 8;
  // Tapered closed wall rings form a vase rather than a rounded bowl balanced on its underside.
  for (let index = 1; index < levels.length; index++) {
    const [bottom, bottomRadius] = levels[index - 1]!, [top, topRadius] = levels[index]!;
    add({ shape: "cylinder", position: [0, (bottom + top) / 2, 0],
      size: [bottomRadius * 2, top - bottom, bottomRadius * 2],
      topScale: [topRadius / bottomRadius, 1, topRadius / bottomRadius],
      radialSegments: segments, surface: "plaster", tint: [...tint] });
  }
  add({ shape: "cylinder", position: [0, .012, 0], size: [.23, .024, .23],
    radialSegments: segments, surface: "plaster", tint: [...tint] });
  add({ shape: "cylinder", position: [0, height + .002, 0], radialSegments: segments,
    size: [.33, .016, .33], surface: "dark" });
  if (builder.detailed) for (let band = 0; band < 2; band++) {
    const y = height - .015 - band * .055;
    add({ shape: "cylinder", position: [0, y, 0], size: [.387, .014, .387],
      radialSegments: segments, surface: "plaster", tint: [.86, .76, .54] });
  }
  return height;
};
