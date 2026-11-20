import { BufferGeometry, Float32BufferAttribute } from "three";

import type { RoadProfilePart } from "../../render-common/road-decoration-recipe";

/** CPU-only neutral templates: no cached GPU object or per-colour geometry. */
const templates = new Map<boolean, { positions: Float32Array; colors: Float32Array }>();
const createTemplate = (detailed: boolean) => {
  const positions: number[] = [], colors: number[] = [], tiers = detailed ? 10 : 5;
  const outline = detailed ? [[-.15, 0, 0], [-.16, .075, .015], [-.06, .13, .045],
    [.07, .12, .045], [.16, .04, .015], [.05, -.065, .06]] : [[-.15, .04, 0], [.14, .10, 0], [0, -.06, .05]];
  const points = [...outline, [0, .03, .08], [0, .03, -.02]];
  const appendBloom = (tier: number, bloom: number) => {
    const t = tier / (tiers - 1), yaw = tier * 2.39996 + bloom * Math.PI;
    const radius = .22 * (1 - t) ** .65 + .01, y = .37 - .8 * t, scale = 1 - t * .5;
    for (const [center, reverse] of [[outline.length, false], [outline.length + 1, true]] as const)
      for (let edge = 0; edge < outline.length; edge++) {
        const indices = reverse ? [center, (edge + 1) % outline.length, edge]
          : [center, edge, (edge + 1) % outline.length];
        for (const index of indices) {
          const point = points[index]!, x = point[0]! * scale, z = point[2]! * scale;
          positions.push(Math.sin(yaw) * radius + Math.cos(yaw) * x + Math.sin(yaw) * z,
            y + point[1]! * scale, Math.cos(yaw) * radius - Math.sin(yaw) * x + Math.cos(yaw) * z);
          const shade = index === outline.length ? 1 : .88 + tier % 2 * .05;
          colors.push(shade, shade, shade);
        }
      }
  };
  for (let tier = 0; tier < tiers; tier++) for (let bloom = 0; bloom < 2; bloom++) appendBloom(tier, bloom);
  const result = { positions: Float32Array.from(positions), colors: Float32Array.from(colors) };
  templates.set(detailed, result); return result;
};

export const createRoadDecorationRaceme = (part: RoadProfilePart, detailed: boolean) => {
  const template = templates.get(detailed) ?? createTemplate(detailed), geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(template.positions.slice(), 3));
  geometry.setAttribute("color", new Float32BufferAttribute(template.colors.slice(), 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(template.positions.length / 3 * 2), 2));
  geometry.scale(...part.size);
  if (part.rotation) { geometry.rotateX(part.rotation[0]); geometry.rotateY(part.rotation[1]); geometry.rotateZ(part.rotation[2]); }
  geometry.translate(...part.position); geometry.computeVertexNormals(); return geometry;
};
