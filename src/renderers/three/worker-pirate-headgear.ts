import { BufferGeometry, Float32BufferAttribute } from "three";

/** Original soft three-corner felt brim: three folded sides around a fitted cloth crown. */
export const createPirateBrim = (detailed: boolean, tall: boolean) => {
  const segments = detailed ? 36 : 15, rings = detailed ? 5 : 2;
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const outer = tall ? .207 : .233, inner = .115;
  for (let ring = 0; ring <= rings; ring++) for (let segment = 0; segment <= segments; segment++) {
    const angle = segment / segments * Math.PI * 2, t = ring / rings;
    const side = (.5 + .5 * Math.cos(angle * 3 + Math.PI)) ** 1.5;
    const radius = inner + (outer - inner - side * .035) * t;
    const raised = side * (tall ? .112 : .084) * t * t;
    positions.push(Math.sin(angle) * radius, .119 + raised - .012 * Math.sin(t * Math.PI),
      Math.cos(angle) * radius);
    uv.push(segment / segments * 3, t);
  }
  for (let ring = 0; ring < rings; ring++) for (let segment = 0; segment < segments; segment++) {
    const a = ring * (segments + 1) + segment, b = a + segments + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new BufferGeometry(); geometry.setIndex(indices);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2)); geometry.computeVertexNormals();
  return geometry;
};
