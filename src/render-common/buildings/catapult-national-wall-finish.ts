import type { BuildingPart, Point3 } from "./building-recipe";
import { CATAPULT_SHAFT_HEIGHT } from "./catapult-dimensions";
import { type CatapultShellNation, catapultShellOuterRadius, catapultShellVoid } from "./catapult-national-shell-profile";
import { CHINESE_TIMBER } from "./chinese-building-roofs";
import { addBambooPole } from "./japanese-bamboo-roof";
import { runBetween } from "./nation-kit-parts";

/** Same private wall painters/palette as ordinary national buildings; no generic stone substitute. */
export const catapultNationalWallSurface = (nation: CatapultShellNation): BuildingPart["surface"] => {
  if (nation === "japanese") return "japanese-catapult-stone";
  if (nation === "chinese") return "chinese-red-brick";
  if (["nubian", "persian"].includes(nation)) return "plaster";
  if (nation === "viking") return "wood";
  if (nation === "indigenous") return "indigenous-rubble";
  return "stone";
};

export const catapultNationalWallFinish = (nation: CatapultShellNation, detailed: boolean): BuildingPart[] => {
  const parts: BuildingPart[] = [];
  const add = (part: Omit<BuildingPart, "stage"> & { stage?: number }) =>
    parts.push({ ...part, architecture: true, stage: part.stage ?? 2 });
  const point = (angle: number, y: number, out = 0): Point3 => {
    const radius = catapultShellOuterRadius(nation, angle, y) + out;
    return [Math.sin(angle) * radius, y, Math.cos(angle) * radius];
  };
  const band = (bottom: number, height: number, surface: BuildingPart["surface"], tint?: Point3) =>
    add({ shape: "catapult-shell-band", catapultShellNation: nation,
      catapultShellBand: [bottom, bottom + height], position: [0, bottom + height / 2, 0],
      size: [1.7, height, 1.7], surface, tint, stage: 2 });
  if (nation === "persian") {
    for (const bottom of [1.13, 1.70]) band(bottom, .038, "paint", [.035, .20, .43]);
    band(0, .16, "cut-stone", [.86, .79, .66]);
  }
  if (nation === "nubian") {
    band(0, .17, "plaster");
    for (let index = 0; index < 12; index++) {
      const angle = index * Math.PI / 6, y = CATAPULT_SHAFT_HEIGHT * .78;
      if (catapultShellVoid(angle, y)) continue;
      runBetween(add, point(angle, y, -.055), point(angle, y, .085), [.045, .045],
        { shape: "cylinder", radialSegments: detailed ? 7 : 4, surface: "wood", stage: 2 });
    }
  }
  if (nation === "chinese") {
    const corners: Point3[] = [[.515, 0, .735], [.735, 0, .515], [.735, 0, -.515], [.515, 0, -.735],
      [-.515, 0, -.735], [-.735, 0, -.515], [-.735, 0, .515], [-.515, 0, .735]];
    const angles = corners.map(corner => Math.atan2(corner[0], corner[2]));
    const timber = { surface: "paint" as const, tint: CHINESE_TIMBER, stage: 2 };
    for (const angle of angles) {
      add({position:point(angle,.025,.012),size:[.10,.05,.10],shape:"box",surface:"cut-stone",stage:1});
      runBetween(add,point(angle, .04, .012), point(angle, CATAPULT_SHAFT_HEIGHT - .055, .012), [.075, .075], timber);
    }
    for (const y of [1.17, CATAPULT_SHAFT_HEIGHT - .055]) for (let index = 0; index < angles.length; index++)
      runBetween(add, point(angles[index]!, y, .012),
        point(angles[(index + 1) % angles.length]!, y, .012), [.055, .055], timber);
    // Two golden culms brace the actual red lintel-to-post joints; this is not Japan's corner bundling.
    for (const sign of [-1, 1]) addBambooPole(part => add({ ...part, tint: [.95, .95, 1] }),
      [sign * .515, CATAPULT_SHAFT_HEIGHT - .31, .751],
      [sign * .28, CATAPULT_SHAFT_HEIGHT - .055, .751], .038, .2);
  }
  if (nation === "japanese") {
    const angles = [Math.PI / 4, Math.PI * .75, Math.PI * 1.25, Math.PI * 1.75];
    const bamboo = (part: BuildingPart) => add({ ...part, tint: [.30, .32, .70] });
    for(const angle of angles)add({position:point(angle,.025,.004),size:[.13,.05,.13],
      shape:"box",surface:"japanese-white-stone",stage:1});
    for (const angle of angles) for (const side of [-1, 1]) {
      const from = point(angle, .04, .004), to = point(angle, CATAPULT_SHAFT_HEIGHT - .04, .004);
      for (const end of [from, to]) {
        end[0] += Math.cos(angle) * side * .02;
        end[2] -= Math.sin(angle) * side * .02;
      }
      addBambooPole(bamboo, from, to, .045, side * .2);
    }
    // Low side/rear ties join the bundles. The front stays open around the real entrance.
    for (const y of [.28, .96]) for (let index = 0; index < angles.length - 1; index++)
      addBambooPole(bamboo, point(angles[index]!, y, .012), point(angles[index + 1]!, y, .012), .04, .3);
  }
  if (nation === "viking") band(0, .24, "stone");
  return parts;
};
