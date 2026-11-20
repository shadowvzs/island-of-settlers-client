import atlas from "../../../../assets/textures/national-thatch/dry-palm-fibres.json";

const decode = (encoded: string) => Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
const palette = decode(atlas.palette), pixels = decode(atlas.pixels);
const mirror = (value: number) => 1 - Math.abs((value - Math.floor(value / 2) * 2) - 1);

/** Shared CPU-only material scan; no DOM, image loading or GPU dependency in world workers. */
export const sampleThatchFibres = (u: number, v: number): [number, number, number] => {
  const x = mirror(u) * (atlas.width - 1), y = mirror(v) * (atlas.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const colour = [0, 0, 0] as [number, number, number];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const index = pixels[Math.min(y0 + dy, atlas.height - 1) * atlas.width + Math.min(x0 + dx, atlas.width - 1)]!;
    const weight = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) / 255;
    for (let channel = 0; channel < 3; channel++) colour[channel]! += palette[index * 3 + channel]! * weight;
  }
  return colour;
};
