import type * as Three from "three";

/** Shared by the victory emblem modules, which receive the render page's Three.js module. */
export type ThreeModule = typeof Three;

export const canvasTexture = (T: ThreeModule, size: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
  draw(canvas.getContext("2d")!);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

/** Deterministic pseudo-random numbers, so every re-render gives the same image. */
export const seededRandom = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
