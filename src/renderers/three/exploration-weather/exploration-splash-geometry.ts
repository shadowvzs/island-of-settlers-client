/**
 * Irregular, unit-sized shapes of the FPS rain impacts (y up, radius about 1). Each instance is
 * yawed and squashed at random, so no two impacts share an outline: a crown of thin droplet
 * streaks flung up and out, and a broken, uneven ripple ring. Built once per splash object.
 */
import { BufferAttribute, BufferGeometry } from "three";

import { createPresentationRandom } from "./presentation-random";

const CROWN_DROPLETS = 9;
const RIPPLE_SEGMENTS = 28;

const toGeometry = (positions: number[]) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(Float32Array.from(positions), 3));
  return geometry;
};

/** Thin streaks of uneven length and lean around the impact point (one triangle each). */
export const createCrownSplashGeometry = (seed: number) => {
  const random = createPresentationRandom(seed);
  const positions: number[] = [];
  for (let droplet = 0; droplet < CROWN_DROPLETS; droplet++) {
    const azimuth = (droplet / CROWN_DROPLETS) * Math.PI * 2 + (random() - 0.5) * 0.6;
    const cos = Math.cos(azimuth), sin = Math.sin(azimuth);
    const start = 0.15 + random() * 0.25;
    const reach = 0.55 + random() * 0.5;
    const rise = 0.35 + random() * 0.65;
    const width = 0.05 + random() * 0.06;
    positions.push(
      cos * start - sin * width, 0, sin * start + cos * width,
      cos * start + sin * width, 0, sin * start - cos * width,
      cos * reach, rise, sin * reach
    );
  }
  return toGeometry(positions);
};

/** Flat ring with gaps and uneven width and radius, lying on the surface. */
export const createRippleGeometry = (seed: number) => {
  const random = createPresentationRandom(seed);
  const positions: number[] = [];
  const ring = Array.from({ length: RIPPLE_SEGMENTS + 1 }, (_, index) => {
    const azimuth = (index / RIPPLE_SEGMENTS) * Math.PI * 2;
    const radius = 1 + 0.09 * Math.sin(azimuth * 3 + 1.3) + (random() - 0.5) * 0.08;
    return { cos: Math.cos(azimuth), radius, sin: Math.sin(azimuth), width: 0.04 + random() * 0.08 };
  });
  for (let index = 0; index < RIPPLE_SEGMENTS; index++) {
    if (random() < 0.22) continue;
    const a = ring[index]!, b = ring[index + 1]!;
    const outerA = [a.cos * a.radius, 0, a.sin * a.radius];
    const innerA = [a.cos * (a.radius - a.width), 0, a.sin * (a.radius - a.width)];
    const outerB = [b.cos * b.radius, 0, b.sin * b.radius];
    const innerB = [b.cos * (b.radius - b.width), 0, b.sin * (b.radius - b.width)];
    positions.push(...innerA, ...outerA, ...outerB, ...innerA, ...outerB, ...innerB);
  }
  return toGeometry(positions);
};
