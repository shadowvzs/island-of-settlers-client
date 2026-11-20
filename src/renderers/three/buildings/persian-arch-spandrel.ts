import { ExtrudeGeometry, Shape } from "three";

import { persianArchHeight } from "../../../render-common/buildings/persian-arched-facade";

/** Thick pointed-arch spandrel with actual open air below; normalized to the recipe's full unit box. */
export const createPersianArchSpandrel = (openingWidth: number, openingRise: number, detailed: boolean, aspect = 1) => {
  const width = Math.max(.1, Math.min(.95, openingWidth));
  const rise = Math.max(width / 2, Math.min(.98, openingRise));
  const shape = new Shape(), half = width / 2, segments = detailed ? 40 : 16;
  shape.moveTo(-.5, -.5); shape.lineTo(-half, -.5);
  for (let index = 1; index <= segments; index++) {
    const x = -half + width * index / segments;
    shape.lineTo(x, -.5 + persianArchHeight(x * aspect, width * aspect, rise));
  }
  shape.lineTo(.5, -.5); shape.lineTo(.5, .5); shape.lineTo(-.5, .5); shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: 1, steps: 1, bevelEnabled: true,
    bevelSegments: detailed ? 2 : 1, bevelSize: detailed ? .005 : .003,
    bevelThickness: detailed ? .008 : .005, curveSegments: 1 });
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!, x = box.max.x - box.min.x, y = box.max.y - box.min.y, z = box.max.z - box.min.z;
  geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
  geometry.scale(1 / x, 1 / y, 1 / z);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
