import { japaneseWhiteStoneBaseDetail as japaneseWhiteStoneDetail } from "./japanese-white-stone-detail";
import { seamDistance,type SurfaceSampler } from "./surface-detail-common";

// Integrate the same narrow mortar profile over one texel. Minimal therefore retains
// the joint's contrast without replacing a hairline joint with an oversized dark grid.
const filteredJoint = (value: number, frequency: number, resolution: number) => {
  const distance = ((value + .5) % 1 + 1) % 1 - .5;
  const halfTexel = frequency / (2 * resolution);
  const primitive = (offset: number) => Math.sign(offset) * (1 - Math.exp(-260 * Math.abs(offset))) / 260;
  return (primitive(distance + halfTexel) - primitive(distance - halfTexel)) / (2 * halfTexel);
};

/** Tower-only contrast refinement; ordinary Japanese white walls retain their approved painter. */
export const createJapaneseCatapultStoneDetail = (resolution: number): SurfaceSampler => point => {
  const original = japaneseWhiteStoneDetail(point);
  const y = point.v * 6, x = point.u * 2 + (Math.floor(y) % 2) * .5;
  const previousJoint = Math.exp(-Math.min(seamDistance(x), seamDistance(y)) * 260);
  const joint = Math.max(filteredJoint(x, 2, resolution), filteredJoint(y, 6, resolution));
  return { ...original,
    brightness: original.brightness + previousJoint * .045 - joint * .21,
    height: original.height + previousJoint * .022 - joint * .035
  };
};

export const japaneseCatapultStoneDetail = createJapaneseCatapultStoneDetail(512);
export const japaneseCatapultStoneMinimalDetail = createJapaneseCatapultStoneDetail(256);
