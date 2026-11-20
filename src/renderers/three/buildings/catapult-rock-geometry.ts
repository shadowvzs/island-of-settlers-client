import {
  CanvasTexture, DataTexture, Float32BufferAttribute, IcosahedronGeometry, LinearFilter, LinearMipmapLinearFilter,
  MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace, Vector2, Vector3
} from "three";

const mineralNoise = (x: number, y: number, z: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * Fresh, independently owned geometry: broad fractures and chips retain their shape in both LODs.
 * Small pebbles (the granite bundle) pass a lower subdivision; a full-size stone keeps the default.
 */
export const createCatapultRockGeometry = (detailed: boolean, subdivision = detailed ? 3 : 1) => {
  const geometry = new IcosahedronGeometry(.5, subdivision);
  const vertices = geometry.getAttribute("position");
  const colours = new Float32Array(vertices.count * 3);
  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index) * 2, y = vertices.getY(index) * 2, z = vertices.getZ(index) * 2;
    const bulge = 1 + .15 * Math.sin(x * 3.9 + z * 2.1)
      + .09 * Math.cos(y * 4.7 - x * 2.4) + .055 * Math.sin(z * 7 + y * 3);
    let px = x * .48 * bulge, py = y * .43 * bulge, pz = z * .45 * bulge;
    // Oblique fracture planes, rather than a radially smooth or uniformly triangulated ball.
    const fracture = px + py * .55 - pz * .25 - .39;
    if (fracture > 0) {
      px -= fracture / 1.365;
      py -= fracture * .55 / 1.365;
      pz += fracture * .25 / 1.365;
    }
    py = Math.max(-.33 + px * .08, py);
    pz = Math.max(-.34 - px * .18, pz);
    vertices.setXYZ(index, px, py, pz);
    const grain = mineralNoise(x, y, z), shade = .74 + grain * .22;
    colours.set([shade * 1.015, shade, shade * .96], index * 3);
  }
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, size = bounds.getSize(new Vector3());
  const centre = bounds.getCenter(new Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

export const textureFromPixels = (pixels: Uint8Array, size: number) => {
  if (typeof document === "undefined") return new DataTexture(pixels, size, size, RGBAFormat);
  // GLTFExporter flips a normal-map channel through drawImage when a mesh has no tangents.
  // A canvas image supports that round trip as well as normal runtime texture upload.
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
  return new CanvasTexture(canvas);
};

const createMineralTextures = (detailed: boolean) => {
  const size = detailed ? 128 : 64;
  const colour = new Uint8Array(size * size * 4), normals = new Uint8Array(size * size * 4);
  const heightAt = (x: number, y: number) => mineralNoise((x + size) % size, (y + size) % size, 13);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = heightAt(x, y), fleck = heightAt(Math.floor(x / 3), Math.floor(y / 3));
    const seam = Math.abs(Math.sin(x * .11 + Math.sin(y * .065) * 2.5)) < .045;
    let shade = 130 + grain * 28 + fleck * 18;
    if (fleck < .12) shade -= 30;
    if (fleck > .88) shade += 23;
    if (seam) shade -= 18;
    const offset = (y * size + x) * 4;
    colour.set([shade * 1.025, shade, shade * .96, 255], offset);
    const dx = (heightAt(x - 1, y) - heightAt(x + 1, y)) * .35;
    const dy = (heightAt(x, y - 1) - heightAt(x, y + 1)) * .35;
    const length = Math.hypot(dx, dy, 1);
    normals.set([(dx / length * .5 + .5) * 255, (dy / length * .5 + .5) * 255,
      (.5 / length + .5) * 255, 255], offset);
  }
  const map = textureFromPixels(colour, size);
  map.colorSpace = SRGBColorSpace;
  const normalMap = textureFromPixels(normals, size);
  for (const texture of [map, normalMap]) {
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }
  return { map, normalMap };
};

/** Original mineral flecks and fracture grain; no masonry joints or polished highlights. */
export const createCatapultRockMaterial = (detailed: boolean) => {
  const { map, normalMap } = createMineralTextures(detailed);
  if (!detailed) normalMap.dispose();
  return new MeshStandardMaterial({ map, metalness: 0, normalMap: detailed ? normalMap : null,
    normalScale: new Vector2(.45, .45), roughness: .98, vertexColors: true });
};

export const disposeCatapultRockMaterial = (material: MeshStandardMaterial) => {
  material.map?.dispose(); material.normalMap?.dispose(); material.dispose();
};
