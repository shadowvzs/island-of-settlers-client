import {
  INDIGENOUS_BUILDING_MOTIFS, INDIGENOUS_MOTIF_ATLAS
} from "../../../render-common/buildings/indigenous-building-motifs";
import { indigenousCaveMineral } from "./indigenous-cave-art-minerals";
import { indigenousCaveScene } from "./indigenous-cave-art-scenes";
import { indigenousClothDetail } from "./indigenous-surface-detail";
import type { SurfaceSampler } from "./surface-detail-common";

/** A single bounded atlas keeps diffuse/normal/roughness material ownership shared across motifs. */
export const indigenousCaveArtAtlas: SurfaceSampler = point => {
  const { columns, rows } = INDIGENOUS_MOTIF_ATLAS;
  const column = Math.min(columns-1,Math.max(0,Math.floor(point.u*columns)));
  const row = Math.min(rows-1,Math.max(0,Math.floor(point.v*rows)));
  const motif = INDIGENOUS_BUILDING_MOTIFS[row*columns+column]!;
  const u = point.u*columns-column, v = point.v*rows-row;
  const local = {...point,u,v}, textile = indigenousClothDetail(local);
  const x=(u-.145)/.12, y=(v-.62)/.19;
  if (!motif || Math.abs(x)>1 || Math.abs(y)>1 ||
    !(indigenousCaveScene(motif,x,y) || indigenousCaveMineral(motif,x,y))) return textile;
  // Uneven worn pigment follows the yarn relief; it never replaces the underlying woven normal.
  const opacity = .73 + point.grain*.13 - point.weather*.08;
  const pigment = [.30,.195,.11];
  return {...textile, colour:textile.colour.map((value,axis)=>
    value*(1-opacity)+pigment[axis]!*opacity) as [number,number,number],
    height:textile.height+.004,roughness:245};
};
