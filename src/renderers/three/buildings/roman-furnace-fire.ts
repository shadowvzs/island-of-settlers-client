import {
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  SRGBColorSpace,
  VectorKeyframeTrack
} from "three";

import { sinHash2 } from "../../../shared/world/noise";
import { cachedPixels } from "./building-pixel-cache";

const noise = (x: number, y: number) => {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const low = sinHash2(ix, iy) * (1 - sx) + sinHash2(ix + 1, iy) * sx;
  const high = sinHash2(ix, iy + 1) * (1 - sx) + sinHash2(ix + 1, iy + 1) * sx;
  return low * (1 - sy) + high * sy;
};
const paintFlame = (width: number, seed: number) => {
  const height = width * 2;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1),
        v = y / (height - 1);
      const turbulence =
        noise(u * 9 + seed, v * 4) * 0.6 +
        noise(u * 21 + seed, v * 9) * 0.28 +
        noise(u * 43, v * 17 + seed) * 0.12;
      const sway = Math.sin(v * 10 + seed) * v * 0.12;
      const radius = Math.abs((u - 0.5) * 2 + sway);
      const density = (1 - v) * 0.84 + (turbulence - 0.45) * 0.65 - radius * 0.64;
      const edgeFade = Math.min(1, Math.max(0, density * 8));
      const baseFade = Math.min(1, v * 22);
      const heat = Math.max(0, Math.min(1, density * 1.6));
      const offset = (y * width + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 60 + heat * 160;
      pixels[offset + 2] = 4 + heat * heat * 70;
      pixels[offset + 3] = edgeFade * baseFade * 225;
    }
  return pixels;
};
/**
 * Original turbulent flame texture, with soft transparent edges and hotter yellow cores (base at v 0).
 * Also the Minimal billboard flame of burning colony forts.
 */
export const createFlameTexture = (detailed: boolean, seed: number) => {
  const width = detailed ? 128 : 32;
  const pixels = cachedPixels(`flame:${width}:${seed}`, () => paintFlame(width, seed));
  const texture = new DataTexture(pixels, width, width * 2, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};
const paintSmoke = (size: number) => {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1),
        v = y / (size - 1);
      const radius = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2);
      const softEdge = Math.pow(Math.max(0, 1 - radius * radius), 2);
      const turbulence = noise(u * 8, v * 8) * 0.65 + noise(u * 19, v * 19) * 0.35;
      const density = softEdge * (0.25 + turbulence * 0.75);
      const shade = 150 + turbulence * 35;
      pixels.set([shade, shade + 2, shade, density * 190], (y * size + x) * 4);
    }
  return pixels;
};
/** Soft turbulent cloud opacity avoids a solid silhouette on the 3D smoke wisps. */
export const createRomanSmokeTexture = (detailed: boolean) => {
  const size = detailed ? 128 : 32;
  const pixels = cachedPixels(`smoke:${size}`, () => paintSmoke(size));
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

const paintEmbers = (width: number) => {
  const height = width / 2;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = (x / width) * 7,
        v = (y / height) * 3;
      const cx = u - Math.floor(u) - 0.5,
        cy = v - Math.floor(v) - 0.5;
      const radius = Math.hypot(cx, cy);
      const turbulence = noise(u * 3, v * 3);
      const edge = Math.max(0, 1 - Math.abs(radius - 0.34) * 16) * turbulence;
      const ash = 16 + turbulence * 24;
      pixels.set([ash + edge * 200, ash * 0.65 + edge * 63, ash * 0.45, 255], (y * width + x) * 4);
    }
  return pixels;
};

/** Charcoal clusters have dark centres and irregular glowing cracks, never a solid orange bar. */
export const createRomanEmberTexture = (detailed: boolean) => {
  const width = detailed ? 64 : 16;
  const pixels = cachedPixels(`embers:${width}`, () => paintEmbers(width));
  const texture = new DataTexture(pixels, width, width / 2, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

const flameMotion = (time: number, index: number) => {
  const phase = time * Math.PI * 2;
  return {
    x: Math.sin(phase * 3 + index) * 0.009,
    scale: [
      0.96 + Math.sin(phase * 2 + index) * 0.055,
      0.92 + Math.sin(phase * 5 + index * 2) * 0.1,
      1
    ]
  };
};
export const createRomanFurnaceFire = (detailed: boolean, name = "smelter_fire") => {
  const root = new Group();
  root.name = name;
  for (let index = 0; index < (detailed ? 5 : 2); index++) {
    const map = createFlameTexture(detailed, index * 19);
    const material = new MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      opacity: index === 0 ? 0.95 : 0.7
    });
    // Closed, curved flame tongues have depth and remain visible from side angles.
    const geometry = new CylinderGeometry(0, 1, 1, detailed ? 8 : 5, detailed ? 7 : 4, true);
    const positions = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const height = positions.getY(vertex) + 0.5;
      const taper = 0.8 + Math.sin(height * 8 + index) * height * 0.15;
      positions.setXYZ(
        vertex,
        positions.getX(vertex) * 0.068 * taper + Math.sin(height * 7 + index) * height * 0.024,
        height * (0.19 + (index % 3) * 0.025),
        positions.getZ(vertex) * 0.045 * taper
      );
      uv.setXY(vertex, uv.getX(vertex), height);
    }
    geometry.computeVertexNormals();
    geometry.setAttribute(
      "color",
      new Float32BufferAttribute(
        new Float32Array(geometry.attributes.position!.count * 3).fill(1),
        3
      )
    );
    const flame = new Mesh(geometry, material);
    flame.name = `${name}_tongue_${index}`;
    flame.position.set(((index % 3) - 1) * 0.055, 0, -Math.floor(index / 3) * 0.035);
    flame.rotation.y = index * 1.8;
    flame.userData.ownedMaterial = true;
    flame.userData.ownedMap = true;
    root.add(flame);
  }
  return root;
};
export const updateRomanFurnaceFire = (root: Group, time: number) => {
  root.scale.y = 1 + Math.sin(time * 11) * 0.06;
  for (let index = 0; index < root.children.length; index++) {
    const motion = flameMotion(time, index);
    root.children[index]!.scale.set(...(motion.scale as [number, number, number]));
    root.children[index]!.position.x = ((index % 3) - 1) * 0.055 + motion.x;
  }
};
export const romanFurnaceFireTracks = (detailed: boolean, name = "smelter_fire") => {
  const times = Array.from({ length: 41 }, (_value, index) => index / 20);
  const tracks = [
    new VectorKeyframeTrack(
      `${name}.scale`,
      times,
      times.flatMap((time) => [1, 1 + Math.sin(time * 11) * 0.06, 1])
    )
  ];
  for (let index = 0; index < (detailed ? 5 : 2); index++) {
    tracks.push(
      new VectorKeyframeTrack(
        `${name}_tongue_${index}.scale`,
        times,
        times.flatMap((time) => flameMotion(time, index).scale)
      )
    );
    tracks.push(
      new VectorKeyframeTrack(
        `${name}_tongue_${index}.position`,
        times,
        times.flatMap((time) => [
          ((index % 3) - 1) * 0.055 + flameMotion(time, index).x,
          0,
          -Math.floor(index / 3) * 0.035
        ])
      )
    );
  }
  return tracks;
};
