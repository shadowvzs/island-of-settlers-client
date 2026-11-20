import { MATERIAL } from "../../shared/world/world-data";
import type { GroundLayerSet } from "../materials/material-textures";

const winterMaterials = new WeakMap<GroundLayerSet, GroundLayerSet>();
const WET_SHORE_TINTS = [
  { material: MATERIAL.sand, tint: [.68, .75, .81] },
  { material: MATERIAL.dirt, tint: [.65, .70, .76] },
  { material: MATERIAL.gravel, tint: [.83, .88, .94] }
] as const;

/** Greys one albedo layer's texels (offsets start..end) and cools them by the tint; height stays. */
const tintLayer = (albedoHeight: Uint8Array, start: number, end: number, tint: readonly number[]) => {
  for (let offset = start; offset < end; offset += 4) {
    const luminance = albedoHeight[offset]! * .3 + albedoHeight[offset + 1]! * .59 +
      albedoHeight[offset + 2]! * .11;
    for (let channel = 0; channel < 3; channel++)
      albedoHeight[offset + channel] = Math.round(luminance * tint[channel]!);
  }
};

/** Cool wet sand in the ground layers; dry upper banks already use the original snow tile. */
export const getWinterGroundMaterials = (source: GroundLayerSet): GroundLayerSet => {
  const cached = winterMaterials.get(source);
  if (cached) return cached;
  const albedoHeight = source.albedoHeight.slice();
  const layerBytes = source.size * source.size * 4;
  for (const { material, tint } of WET_SHORE_TINTS)
    tintLayer(albedoHeight, material * layerBytes, (material + 1) * layerBytes, tint);
  const result = { ...source, albedoHeight };
  winterMaterials.set(source, result);
  return result;
};
