import { BoxGeometry } from "three";

import type { BuildingLevel } from "../../../render-common/buildings/levels/building-level";

type Stroke = readonly [number, number, number, number];
/** Arabic numerals as small shared gold strokes, with an angled flag and foot on 1. */
const DIGITS: Readonly<Record<BuildingLevel, readonly Stroke[]>> = {
  1: [[-.065, .07, .01, .12], [.01, .12, .01, -.12], [-.07, -.12, .08, -.12]],
  2: [[-.08, .12, .08, .12], [.08, .12, .08, .015], [.08, .015, -.08, -.07],
    [-.08, -.07, -.08, -.12], [-.08, -.12, .08, -.12]],
  3: [[-.08, .12, .08, .12], [.08, .12, .08, -.12], [-.045, 0, .08, 0], [-.08, -.12, .08, -.12]],
  4: [[-.08, .12, -.08, 0], [-.08, 0, .08, 0], [.08, .12, .08, -.12]],
  5: [[-.08, .12, .08, .12], [-.08, .12, -.08, 0], [-.08, 0, .08, 0],
    [.08, 0, .08, -.12], [-.08, -.12, .08, -.12]]
};

export const buildingLevelDigitParts = (level: BuildingLevel) => DIGITS[level].map(([x1, y1, x2, y2]) =>
  new BoxGeometry(.033, Math.hypot(x2 - x1, y2 - y1) + .018, .032)
    .rotateZ(-Math.atan2(x2 - x1, y2 - y1)).translate((x1 + x2) / 2, (y1 + y2) / 2, .045));
