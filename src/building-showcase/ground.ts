import {
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace
} from "three";

/** A worn patch in meadow grass, for reviewing village assets against natural ground. */
export const createVillagePreviewGround = () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(512, 512);
  const grass = [87, 101, 72],
    earth = [111, 94, 72];
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      const worldX = (x / 512 - 0.5) * 20,
        worldZ = (y / 512 - 0.5) * 20;
      const grain =
        (((Math.imul(x + 17, 374761393) ^ Math.imul(y + 29, 668265263)) >>> 0) % 1000) / 1000;
      const edge = Math.sin(worldX * 5 + worldZ * 3) * 0.1 + Math.sin(worldZ * 9) * 0.04;
      const distance = Math.hypot(worldX / 1.9, (worldZ - 0.4) / 1.7);
      const wear = Math.max(0, Math.min(1, (1.1 + edge - distance) * 3));
      const variation = 0.89 + grain * 0.2;
      const offset = (y * 512 + x) * 4;
      for (let channel = 0; channel < 3; channel++)
        pixels.data[offset + channel] =
          (grass[channel]! * (1 - wear) + earth[channel]! * wear) * variation;
      pixels.data[offset + 3] = 255;
    }
  context.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.offset.set(0.5, 0.5);
  texture.anisotropy = 8;
  const mesh = new Mesh(
    new PlaneGeometry(80, 80),
    new MeshStandardMaterial({ map: texture, roughness: 1 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.002;
  mesh.receiveShadow = true;
  return mesh;
};
