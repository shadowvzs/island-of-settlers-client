import { BufferGeometry, Float32BufferAttribute } from "three";

import {
  indigenousRoofHeight, type IndigenousRoofProfile
} from "../../../render-common/buildings/indigenous-roof-profile";
import { cutIndigenousClothOpenings } from "./indigenous-cloth-cutouts";
import { indigenousEntranceSamples } from "./indigenous-entrance-samples";
import { type PolarRoofVertex,stitchIndigenousPolarLoops } from "./indigenous-polar-stitch";

/** Radius of the elliptical capsule footprint along a ray, with its straight sides and curved ends. */
const skirtRadius = (profile: IndigenousRoofProfile, sine: number, cosine: number) => {
  if (profile === "tipi") return .5;
  let low = 0, high = .75;
  for (let step = 0; step < 18; step++) {
    const radius = (low + high) / 2;
    const across = Math.abs(radius * sine) * 2;
    const end = Math.max(0, Math.abs(radius * cosine) * 2 - .4) / .6;
    if (Math.hypot(across, end) > 1) high = radius;
    else low = radius;
  }
  return low;
};

/** Continuous rounded fabric rather than a square sheet clipped into a cone. */
export const createIndigenousRoundedSkin = (profile: "tipi" | "earth", detailed: boolean,
  entrance?: [number, number, number], rearEntrance?: [number, number, number], cutout = false) => {
  const around = detailed ? 64 : 24, rings = detailed ? 12 : 5;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const loops: PolarRoofVertex[][] = [];
  const fractions = Array.from({ length: rings + 1 }, (_, ring) => ring / rings);
  if (profile === "tipi" && !cutout) for (const opening of [entrance, rearEntrance]) {
    if (opening && opening[2] > -.5 && opening[2] < .5) fractions.push(.5 - opening[2]);
  }
  const radialSamples = [...new Set(fractions)].sort((a, b) => a - b);
  for (const fraction of radialSamples) {
    const radiusAt = (angle: number) =>
      skirtRadius(profile, Math.sin(angle), Math.cos(angle)) * fraction;
    const samples = indigenousEntranceSamples(around, radiusAt,
      cutout ? undefined : entrance, cutout ? undefined : rearEntrance);
    const loop = [];
    for (const sample of samples) {
      const { angle } = sample, radius = radiusAt(angle);
      const x = sample.x ?? radius * Math.sin(angle), z = radius * Math.cos(angle);
      let sampleX = x;
      for (const opening of [entrance, rearEntrance]) {
        if (!opening) continue;
        if (Math.abs(x - opening[0]) < 1e-7) sampleX += 1e-7;
        if (Math.abs(x - opening[1]) < 1e-7) sampleX -= 1e-7;
      }
      const height = cutout ? indigenousRoofHeight(profile, x, z) :
        indigenousRoofHeight(profile, sampleX, z, entrance, rearEntrance);
      const fold = Math.sin(angle * 18) * Math.sin(fraction * Math.PI) ** 2 * .002;
      loop.push({ angle, edge: sample.edge, vertex: positions.length / 3 });
      positions.push(x, height + fold, z);uvs.push(angle / (Math.PI * 2), 1 - (height + .5));
    }
    loops.push(loop);
  }
  for (let ring = 0; ring < loops.length - 1; ring++)
    stitchIndigenousPolarLoops(loops[ring]!, loops[ring + 1]!, indices);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return cutout ? cutIndigenousClothOpenings(geometry, entrance, rearEntrance) : geometry;
};
