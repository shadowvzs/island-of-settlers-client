import { blockVariation, seamDistance, type SurfaceSampler } from "./surface-detail-common";

/** Quiet lime-white cut blocks: fine straight joints and tiny relief, never a dark ashlar grid. */
export const japaneseWhiteStoneBaseDetail:SurfaceSampler = ({grain,mineral,u,v,weather}) => {
  const y=v*6,row=Math.floor(y),x=u*2+(row%2)*.5;
  const seam=Math.min(seamDistance(x),seamDistance(y));
  const mortar=Math.exp(-seam*260),tone=(blockVariation(Math.floor(x),row)-.5)*.018;
  return {brightness:1+tone+(mineral-.5)*.012-mortar*.045-weather*.012,
    colour:[1,1,.995],height:.50+tone*.22-mortar*.022+(grain-.5)*.006,
    roughness:232+weather*15};
};

/** Ordinary white walls retain fine shallow joints, readable even on the existing 128px Minimal map. */
export const japaneseWhiteStoneDetail: SurfaceSampler = point => {
  const original = japaneseWhiteStoneBaseDetail(point);
  const y = point.v * 6, x = point.u * 2 + (Math.floor(y) % 2) * .5;
  const seam = Math.min(seamDistance(x), seamDistance(y));
  const previousJoint = Math.exp(-seam * 260), joint = Math.exp(-seam * 105);
  return { ...original, brightness: original.brightness + previousJoint * .045 - joint * .16,
    height: original.height + previousJoint * .022 - joint * .028 };
};
