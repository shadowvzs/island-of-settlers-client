import { BoxGeometry, CircleGeometry, ExtrudeGeometry, LatheGeometry, Path, Shape, ShapeGeometry, Vector2 } from "three";

import type { OrnamentalTreeGraph } from "../../../render-common/plants/ornamental-tree-graph";

const roundedRectangle = (width: number, depth: number, radius: number) => {
  const shape = new Shape(), x = -width / 2, z = -depth / 2;
  shape.moveTo(x + radius, z); shape.lineTo(x + width - radius, z);
  shape.quadraticCurveTo(x + width, z, x + width, z + radius);
  shape.lineTo(x + width, z + depth - radius);
  shape.quadraticCurveTo(x + width, z + depth, x + width - radius, z + depth);
  shape.lineTo(x + radius, z + depth);
  shape.quadraticCurveTo(x, z + depth, x, z + depth - radius);
  shape.lineTo(x, z + radius); shape.quadraticCurveTo(x, z, x + radius, z);
  return shape;
};

/** A hollow ceramic container, flat bearing feet and soil supported inside its actual rim. */
export const createBonsaiPotGeometries = (pot: NonNullable<OrnamentalTreeGraph["pot"]>, detailed: boolean) => {
  const { depth, height, style, width } = pot;
  const segments = detailed ? 32 : 16;
  const ceramic = [];
  let soil;
  if (style === "rectangle") {
    const shape = roundedRectangle(width, depth, .035);
    const inner = roundedRectangle(width - .045, depth - .045, .024);
    const hole = new Path(inner.getPoints(detailed ? 8 : 3).reverse()); shape.holes.push(hole);
    const wall = new ExtrudeGeometry(shape, { depth: height - .04, steps: 1, curveSegments: detailed ? 6 : 2,
      bevelEnabled: true, bevelSegments: detailed ? 2 : 1, bevelSize: .004, bevelThickness: .004 });
    wall.rotateX(-Math.PI / 2); wall.translate(0, .04, 0); ceramic.push(wall);
    ceramic.push(new BoxGeometry(width - .06, .014, depth - .06).translate(0, .043, 0));
    soil = new ShapeGeometry(roundedRectangle(width - .052, depth - .052, .025), detailed ? 6 : 2);
    soil.rotateX(-Math.PI / 2); soil.translate(0, height - .024, 0);
  } else {
    const profile = [[.35, .04], [.40, .06], [.48, height - .025], [.50, height - .012],
      [.49, height], [.46, height - .004], [.425, height - .025], [.32, .05]];
    const wall = new LatheGeometry(profile.map(([radius, y]) => new Vector2(radius! * width, y!)), segments);
    wall.scale(1, 1, depth / width); ceramic.push(wall);
    const floor = new CircleGeometry(width * .35, segments); floor.rotateX(-Math.PI / 2);
    floor.scale(1, 1, depth / width); floor.translate(0, .04, 0); ceramic.push(floor);
    soil = new CircleGeometry(width * .435, segments); soil.rotateX(-Math.PI / 2);
    soil.scale(1, 1, depth / width); soil.translate(0, height - .024, 0);
  }
  for (const x of [-1, 1]) for (const z of [-1, 1])
    ceramic.push(new BoxGeometry(width * .13, .04, depth * .14)
      .translate(x * width * .22, .02, z * depth * .20));
  return { ceramic, soil };
};
