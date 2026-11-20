import { createOrnamentalLeafTextures } from "./ornamental-leaf-textures";

/** Elm-specific fine teeth over the generic pinnate-vein utility, never a palmate maple atlas. */
export const createBonsaiElmLeafTextures = () => {
  const textures = createOrnamentalLeafTextures();
  const { data, height, width } = textures.map.image;
  if (!data) throw new Error("Elm leaf pixels are unavailable");
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / (width - 1), v = y / (height - 1);
    const half = Math.sin(v * Math.PI) * .5;
    const tooth = .010 + .013 * (Math.sin(v * Math.PI * 34) * .5 + .5);
    const edge = half * (1 - tooth), distance = Math.abs(u - .5);
    data[(y * width + x) * 4 + 3] = Math.round(Math.max(0, Math.min(1, (edge - distance) * width + .5)) * 255);
  }
  textures.map.needsUpdate = true;
  return { ...textures, species: "bonsai-elm" as const };
};
