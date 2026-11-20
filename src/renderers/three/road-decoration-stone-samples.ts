import { createPeriodicNoise } from "../../render-common/materials/periodic-noise";
import type { RoadDecorationStoneFamily } from "../../shared/settlement/road-decoration-catalog";
import type { SurfaceSampler } from "./buildings/surface-detail-common";

const quarry = createPeriodicNoise(0x56ac), crystal = createPeriodicNoise(0x238b);
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Decoration stone families plus the bridge-only tier finishes (dark basalt, warm feldspar granite). */
export type StoneSurfaceFamily = RoadDecorationStoneFamily | "basalt" | "warm-granite";

/** Mineral structure has its own relief and roughness; mortar comes from physical block joints. */
export const roadStoneSurface = (family: StoneSurfaceFamily): SurfaceSampler =>
  ({ grain, mineral, u, v, weather }) => {
    const broad = quarry.gradient(u, v, 4), fine = quarry.gradient(u, v, 32);
    const pore = Math.max(0, .37 - grain) * 1.8;
    if (family === "basalt") {
      // Fine-grained dark rock: gas vesicles and faint cooling-column joints, no bedding.
      const vesicle = crystal.worley(u, v, 72), pit = vesicle.nearest < .11 ? 1 : 0;
      const columns = Math.exp(-Math.abs(Math.sin((u * 6 + broad * .15) * Math.PI)) * 22);
      return { brightness: .93 + broad * .06 + fine * .05 - pit * .24 - columns * .07,
        colour: [.97, 1, 1.04],
        height: .5 + fine * .1 - pit * .3 - columns * .1 + mineral * .06,
        roughness: 225 + pit * 20 + weather * 14 };
    }
    if (family === "granite" || family === "warm-granite") {
      const cell = crystal.worley(u + broad * .004, v, 96);
      const mica = cell.nearestId > .80 ? 1 : 0, feldspar = cell.nearestId < .25 ? 1 : 0;
      const crystalRim = clamp((cell.second - cell.nearest) * 7);
      return { brightness: .95 + broad * .07 + fine * .03 - mica * .18 + feldspar * .10,
        colour: [.985 + feldspar * .015, 1, 1.015 - feldspar * .015],
        height: .4 + crystalRim * .25 + mineral * .14 - mica * .12 - pore * .12,
        roughness: 205 + mica * 24 - crystalRim * 18 + weather * 18 };
    }
    if (family === "marble") {
      const phase = (u * 3 + v * 2 + broad * .28 + quarry.gradient(u, v, 9) * .05) * Math.PI * 2;
      const vein = Math.exp(-Math.abs(Math.sin(phase)) * 32);
      const thread = Math.exp(-Math.abs(Math.sin(phase * 2 + fine * .2)) * 65);
      return { brightness: .98 + broad * .04 + fine * .015 - vein * .24 - thread * .08,
        colour: [1 - vein * .12, 1 - vein * .04, 1 + vein * .08],
        height: .52 + fine * .035 - vein * .055 - pore * .07,
        roughness: 155 + vein * 28 + weather * 28 + pore * 30 };
    }
    const bedding = Math.exp(-Math.abs(Math.sin((v * 11 + broad * .22) * Math.PI * 2)) * 18);
    const fossil = crystal.worley(u, v, 20), shell = fossil.nearestId > .91 && fossil.nearest < .19 ? 1 : 0;
    return { brightness: .94 + broad * .10 + fine * .045 - bedding * .09 - pore * .16 + shell * .055,
      colour: [1 + broad * .04, 1, 1 - bedding * .045],
      height: .50 + fine * .12 - pore * .38 - bedding * .12 + shell * .08,
      roughness: 221 + pore * 25 + bedding * 9 + weather * 11 };
  };
