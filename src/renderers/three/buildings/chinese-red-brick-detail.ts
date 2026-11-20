import { blockVariation, seamDistance, type SurfaceSampler, wrapIndex } from "./surface-detail-common";

/** Muted fired brick, straight staggered courses and recessed neutral-grey mortar. Tower-only surface. */
export const chineseRedBrickDetail: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const y = v * 8, row = Math.floor(y), x = u * 3 + (row % 2) * .5;
  const mortar = Math.max(0, 1 - Math.min(seamDistance(x) / .025, seamDistance(y) / .035));
  const variation = blockVariation(wrapIndex(Math.floor(x), 3), wrapIndex(row, 8)) - .5;
  const brightness = (1 + variation * .13 + (mineral - .5) * .04 - weather * .02) * (1 - mortar) + mortar;
  const brick = [1 + variation * .04, 1 - variation * .02, 1 - variation * .025];
  const grey = [123 / 160, 123 / 91, 118 / 72];
  return { brightness, colour: brick.map((value, channel) => value * (1 - mortar) + grey[channel]! * mortar) as [number, number, number],
    height: .56 + variation * .025 + (grain - .5) * .008 - mortar * .13,
    roughness: 237 + weather * 10 + mortar * 8 };
};
