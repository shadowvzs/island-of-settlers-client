import type { BuildingPart } from "./building-recipe";

type LanternPart = Omit<BuildingPart, "stage">;
/** Round segments on High and Minimal. */
const SEGMENTS = { high: 6, minimal: 4 } as const;

/** Japanese tōrō standing at (x, z): base, post, fire box (amber windows on High), roof and jewel. */
export const stoneLanternParts = (x: number, z: number, detailed: boolean): LanternPart[] => {
  const segments = detailed ? SEGMENTS.high : SEGMENTS.minimal;
  const parts: LanternPart[] = [
    { position: [x, .03, z], shape: "box", size: [.2, .06, .2], surface: "cut-stone" },
    { position: [x, .16, z], shape: "cylinder", size: [.07, .2, .07], surface: "cut-stone", radialSegments: segments },
    { position: [x, .285, z], shape: "box", size: [.15, .05, .15], surface: "cut-stone" },
    { position: [x, .35, z], shape: "box", size: [.11, .08, .11], surface: "cut-stone" },
    { position: [x, .425, z], radialSegments: 4, rotation: [0, Math.PI / 4, 0], shape: "cone", size: [.24, .07, .24],
      surface: "cut-stone" },
    { position: [x, .47, z], shape: "sphere", size: [.04, .04, .04], surface: "cut-stone", radialSegments: segments }
  ];
  if (detailed) for (const axis of [0, 2]) parts.push({ position: [x, .35, z], shape: "box",
    size: axis === 0 ? [.115, .045, .05] : [.05, .045, .115], surface: "amber", nightLamp: true });
  return parts;
};
