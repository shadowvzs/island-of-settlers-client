import type { WorkerNation } from "../workers/worker-unit";
import { advancedMaterialBaseDefinition } from "./advanced-material-buildings";
import type { BuildingDefinition } from "./building-catalog";
import { addDrinkSignPaint, getNationDrinkSign } from "./nation-drink-signs";
import { addRomanOccupationPainting } from "./roman-occupation-paintings";
import type { AddPart } from "./roman-resource-workshops";
import { createWellBucketSymbolSvg } from "./well-bucket-symbol";

const createPaintShapeSvg = (
  shape: Parameters<AddPart>[4],
  size: Parameters<AddPart>[2],
  color: string,
  transform: string
) => {
  if (shape === "paint-triangle") {
    return `<polygon points="${-size[0]/2},${size[1]/2} ${size[0]/2},${size[1]/2} 0,${-size[1]/2}" `
      + `fill="${color}" transform="${transform}"/>`;
  }
  if (shape === "sphere" || shape === "paint-ellipse")
    return `<ellipse rx="${size[0] / 2}" ry="${size[1] / 2}" fill="${color}" transform="${transform}"/>`;
  return `<rect x="${-size[0] / 2}" y="${-size[1] / 2}" width="${size[0]}" height="${size[1]}" `
    + `fill="${color}" transform="${transform}"/>`;
};

/**
 * Project the building's own painted symbol, without its architecture or stone tablet; the
 * nation's drink chain buildings show their nation's pictogram (nation-drink-signs.ts).
 */
export const createBuildingOccupationSymbolSvg = (definition: BuildingDefinition, nation?: WorkerNation) => {
  definition = advancedMaterialBaseDefinition(definition);
  if (definition.style === "well") return createWellBucketSymbolSvg();
  let centerY = 0;
  const shapes: string[] = [];
  const part: AddPart = (surface, position, size, _lod, shape, rotation, tint) => {
    if (surface === "stone") { centerY = position[1]; return; }
    if (surface !== "paint" || !tint) return;
    const x = position[0], y = centerY - position[1];
    // The tablet's colored edge belongs on the facade, not inside the sign's pictogram.
    if (Math.abs(y) > .07 && size[0] > .25) return;
    const color = `rgb(${tint.map(value => Math.round(value * 255)).join(",")})`;
    const transform = `translate(${x} ${y}) rotate(${-(rotation?.[2] ?? 0) * 180 / Math.PI})`;
    shapes.push(createPaintShapeSvg(shape, size, color, transform));
  };
  const drinkSign = getNationDrinkSign(definition.id, nation);
  if (drinkSign) addDrinkSignPaint(part, drinkSign, [0, centerY, 0]);
  else addRomanOccupationPainting(definition, part, 1, 1, 1, 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="192" viewBox="-.155 -.11625 .31 .2325"><defs><filter id="depth" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx=".002" dy=".003" stdDeviation=".0018" flood-color="#322415" flood-opacity=".3"/></filter></defs><rect x="-.155" y="-.11625" width=".31" height=".2325" rx=".012" fill="#e9d5a5"/><g filter="url(#depth)">${shapes.join("")}</g></svg>`;
};
