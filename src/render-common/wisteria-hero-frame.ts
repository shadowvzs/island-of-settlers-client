import type { ClimberPoint } from "./road-climber-composition";
import { roadDecorationAdder, type RoadDecorationPart } from "./road-decoration-recipe";
import type { WisteriaRoadFrame } from "./road-decoration-wisteria";
import { wisteriaHeroCrown } from "./wisteria-hero-graph";

export { wisteriaHeroCrown } from "./wisteria-hero-graph";

/** The original liked curved frame remains intact; flat pergola and actual side lattice are distinct joinery. */
export const createWisteriaHeroFrame = (frame: WisteriaRoadFrame, minimal: boolean) => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts), wood: [number, number, number] = [.78, .63, .43];
  for (const side of [-1, 1]) {
    const height = wisteriaHeroCrown(frame, side) - .04;
    add({ shape: "bevel-box", position: [side, height / 2, 0], size: [.12, height, .16], surface: "wood", tint: wood });
  }
  for (const z of [-.24, .24]) {
    if (frame === "curved") parts.push({ kind: "swept-beam", position: [0, 3.25, z],
      size: [2.22, .13, .10], sweep: -.4, profileSegments: minimal ? 8 : 22, surface: "wood", tint: wood });
    else add({ shape: "bevel-box", position: [0, 3.12, z], size: [2.22, .13, .10], surface: "wood", tint: wood });
  }
  for (let slat = 0; slat < 9; slat++) {
    const x = -1.02 + slat / 8 * 2.04;
    add({ shape: "bevel-box", position: [x, wisteriaHeroCrown(frame, x) + .085, 0], size: [.055, .06, .70],
      surface: "wood", tint: wood });
  }
  if (frame === "lattice") for (const side of [-1, 1]) {
    for (const z of [-.26, .26]) add({ shape: "box", position: [side, 1.275, z],
      size: [.035, 2.55, .035], surface: "wood", tint: wood });
    for (const y of [.34, 2.52]) add({ shape: "box", position: [side, y, 0],
      size: [.035, .035, .57], surface: "wood", tint: wood });
    const rows = minimal ? 3 : 4;
    const member = (from: ClimberPoint, to: ClimberPoint) => {
      const dy = to[1] - from[1], dz = to[2] - from[2];
      add({ shape: "box", position: [side, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
        size: [.022, Math.hypot(dy, dz) + .006, .018], rotation: [Math.atan2(dz, dy), 0, 0],
        surface: "wood", tint: wood });
    };
    for (let row = 0; row < rows; row++) {
      const y = .43 + row / (rows - 1) * 1.50;
      member([side, y, -.26], [side, y + .42, .26]);
      member([side, y, .26], [side, y + .42, -.26]);
    }
  }
  return parts;
};
