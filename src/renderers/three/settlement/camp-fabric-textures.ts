import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace
} from "three";

/** Filtered, fine canvas threads and irregular wear: one shared map set, no large checker tiles. */
export const createCampFabricTextures = (detailed: boolean, repeat = 1) => {
  const size = detailed ? 256 : 64;
  const make = () => new Uint8Array(size * size * 4);
  const albedo = make(), normal = detailed ? make() : undefined, rough = detailed ? make() : undefined;
  const height = (x: number, y: number) => {
    const warp = Math.cos(x * Math.PI / 2), weft = Math.cos(y * Math.PI / 2);
    return warp * .22 + weft * .22 + Math.sin(x * 1.13 + y * .97) * .055;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const grain = noise - Math.floor(noise);
    const wear = Math.sin(x * .045 + y * .032) * Math.sin(y * .065) * 4;
    const shade = Math.round(242 + height(x, y) * 5 + (grain - .5) * 5 + wear);
    const offset = (y * size + x) * 4;
    albedo.set([shade, shade, shade, 255], offset);
    if (normal) {
      const dx = (height(x + 1, y) - height(x - 1, y)) * .22;
      const dy = (height(x, y + 1) - height(x, y - 1)) * .22;
      normal.set([Math.round(128 - dx * 127), Math.round(128 - dy * 127), 252, 255], offset);
    }
    if (rough) { const value = Math.round(231 + grain * 14); rough.set([value, value, value, 255], offset); }
  }
  const texture = (image: ReturnType<typeof make>, colour: boolean) => {
    const map = new DataTexture(image, size, size);
    map.needsUpdate = true;
    if (colour) map.colorSpace = SRGBColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping; map.repeat.set(repeat, repeat);
    map.magFilter = LinearFilter; map.minFilter = LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = detailed ? 4 : 1;
    return map;
  };
  const map = texture(albedo, true), normalMap = normal && texture(normal, false), roughnessMap = rough && texture(rough, false);
  return { map, normalMap, roughnessMap, dispose: () => { map.dispose(); normalMap?.dispose(); roughnessMap?.dispose(); } };
};
