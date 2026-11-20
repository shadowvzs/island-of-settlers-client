import type { SurfaceSampler } from "./surface-detail-common";

/** Warm palm stems: fine longitudinal fibres and irregular old leaf-base scars, without sawn plank seams. */
export const palmTrunkDetail: SurfaceSampler = ({grain,mineral,u,v,weather}) => {
  const fibres=Math.sin(u*Math.PI*2*91+Math.sin(v*Math.PI*12)*.18);
  const fine=Math.sin(u*Math.PI*2*237)*.025;
  const scar=Math.pow(.5+.5*Math.cos((v*17+Math.sin(u*Math.PI*6)*.13)*Math.PI*2),18);
  return {brightness:.91+grain*.06+fibres*.045+fine-scar*.07-weather*.025,
    colour:[1,.97+mineral*.02,.91+mineral*.035],
    height:.44+fibres*.065+fine+grain*.035-scar*.085,
    roughness:205+weather*25+scar*12};
};
