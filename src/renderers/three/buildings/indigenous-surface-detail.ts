import { councilHuntingPigment } from "./council-hunting-art";
import { blockVariation, seamDistance, type SurfaceSampler } from "./surface-detail-common";

/** Unequal tanned pelts sewn with sinew: wavy joins, mild tanning variation and fine skin grain. */
export const indigenousHideDetail: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const panelV = v * 3 + Math.sin(u * Math.PI * 2) * .09 + Math.sin(u * Math.PI * 6) * .035;
  const row = Math.floor(panelV);
  const panelU = u * 4 + (row % 2) * .43 + Math.sin(v * Math.PI * 6) * .1;
  const vertical = seamDistance(panelU), horizontal = seamDistance(panelV);
  const seam = Math.min(vertical, horizontal), joint = Math.exp(-seam * 110);
  const tone = blockVariation(Math.floor(panelU), row) - .5;
  const along = vertical < horizontal ? panelV : panelU;
  const stitch = Math.exp(-seam * 85) * Math.pow(Math.max(0, Math.cos(along * Math.PI * 26)), 12);
  return {
    brightness: .96 + tone * .11 + (grain - .5) * .03 - joint * .16 + stitch * .09 - weather * .025,
    colour: [1.025 + tone * .02, 1, .955 - tone * .015],
    height: .46 + (mineral - .5) * .02 - joint * .055 + stitch * .045,
    roughness: 238 + weather * 10
  };
};

/** Undyed tent textile: alternating warp/weft yarns, sewn panels and softer weathered fibres. */
export const indigenousClothDetail: SurfaceSampler = ({ grain, mineral, u, v, weather }) => {
  const warpCoordinate = u * 96 + Math.sin(v * Math.PI * 4) * .1;
  const weftCoordinate = v * 96 + Math.sin(u * Math.PI * 6) * .08;
  const warp = .5 + Math.cos(warpCoordinate * Math.PI * 2) * .5;
  const weft = .5 + Math.cos(weftCoordinate * Math.PI * 2) * .5;
  const over = (Math.floor(warpCoordinate) + Math.floor(weftCoordinate)) % 2 === 0;
  const yarn = over ? warp * .7 + weft * .3 : warp * .3 + weft * .7;
  const panelRow = Math.floor(v * 2), panel = u * 3 + (panelRow % 2) * .35;
  const seam = Math.exp(-Math.min(seamDistance(panel), seamDistance(v * 2)) * 160);
  const stitch = seam * Math.pow(Math.max(0, Math.sin((u + v) * Math.PI * 120)), 10);
  const tone = blockVariation(Math.floor(panel), panelRow) - .5;
  const colour: [number, number, number] = [1.025, 1, .965];
  return {
    brightness: .91 + yarn * .1 + tone * .055 + (grain - .5) * .02 - seam * .13 - stitch * .09,
    colour, height: .4 + yarn * .1 - seam * .035 + stitch * .035 + mineral * .008,
    roughness: 236 + weather * 13 - yarn * 4
  };
};

/** Water-lodge fabric retains its woven relief beneath three hand-painted blue wave bands. */
export const indigenousWaterClothDetail: SurfaceSampler = input => {
  const woven = indigenousClothDetail(input);
  const { u, v } = input;
  const wave = Math.sin(u * Math.PI * 12) * .025;
  const painted = [.36, .44, .52].some(band => Math.abs(v - band - wave) < .013);
  return { ...woven, colour: painted ? [.12, .38, .68] : [1.025, 1, .965] };
};

/** Earth-pigment hunting silhouettes between two broad bands on the distinctive council textile. */
export const indigenousCouncilClothDetail: SurfaceSampler = input => {
  const { grain, mineral, u, v, weather } = input;
  const stems = .5 + .5 * Math.sin(u * Math.PI * 62 + Math.sin(v * 11) * .18);
  const fibres = Math.sin(u * Math.PI * 218 + Math.sin(v * 29) * .3);
  const tone = blockVariation(Math.floor(u * 12), 3) - .5;
  const woven = { brightness: .92 + stems * .055 + fibres * .018 + tone * .055
      + (grain - .5) * .025 - weather * .015,
    colour: [1.025, 1, .92] as [number, number, number],
    height: .42 + stems * .085 + fibres * .012 + mineral * .015, roughness: 239 };
  const pigment = councilHuntingPigment(input.u, 1 - input.v);
  if (!pigment) return woven;
  const wear = .9 + input.grain * .1;
  return { ...woven, colour: [.28 * wear, .22 * wear, .15 * wear],
    height: woven.height + .008, roughness: 243 };
};
