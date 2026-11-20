import { ExtrudeGeometry, Shape } from "three";

export const createRomanToolHead = (axe: boolean, detailed: boolean, segments = detailed ? 8 : 3) => {
  const shape = new Shape();
  if (axe) {
    shape.moveTo(-0.5, -0.2);
    shape.lineTo(-0.15, -0.21);
    shape.quadraticCurveTo(0.17, -0.36, 0.45, -0.5);
    shape.quadraticCurveTo(0.6, 0, 0.45, 0.5);
    shape.quadraticCurveTo(0.1, 0.31, -0.16, 0.2);
    shape.lineTo(-0.5, 0.2);
  } else {
    shape.moveTo(0.5, 0);
    shape.quadraticCurveTo(0.05, 0.47, -0.5, -0.2);
    shape.quadraticCurveTo(-0.12, -0.02, 0.48, -0.2);
  }
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: segments
  });
  geometry.translate(0, 0, -0.5);
  return geometry;
};
