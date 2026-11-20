import { seamDistance, type SurfaceSampler } from "./surface-detail-common";

/** Mature dried bamboo: fine longitudinal fibres, pale swollen nodes and restrained age splits. */
export const japaneseArchitecturalBambooDetail:SurfaceSampler = ({grain,mineral,u,v,weather}) => {
  const fibres=Math.sin(u*Math.PI*182+Math.sin(v*11)*.2)*.025;
  const fine=Math.sin(u*Math.PI*430+Math.sin(v*29)*.3)*.009;
  const node=Math.exp(-seamDistance(v*4)*85);
  const split=Math.exp(-seamDistance(u*5+Math.sin(v*7)*.012)*240)*Math.max(0,Math.sin(v*14+.3));
  return {brightness:.98+fibres+fine+(mineral-.5)*.04-node*.12-split*.06-weather*.025,
    colour:[1.02,1,.95],height:.47+fibres*.8+fine+node*.075-split*.04+(grain-.5)*.012,
    roughness:220+weather*23};
};
