import { Group, MeshPhysicalMaterial, Shape } from "three";

import { polygon, put, slab, surfaces } from "./ui-action-icon-kit";

/** Native bevelled brass and teal transport symbols, intentionally bold at 32px. */
const enamel = () => new MeshPhysicalMaterial({ color: "#269e91", metalness: .3,
  roughness: .22, clearcoat: 1, clearcoatRoughness: .14 });

const symbol = (root: Group, shape: Shape, x = 0, y = 0) => {
  put(root, slab(shape, .13, .035), surfaces.gold, [x, y, 0]);
  const face = put(root, slab(shape, .025, .018), enamel(), [x, y, .10]);
  face.scale.set(.82, .82, 1);
};
const rectangle = (width: number, height: number) => polygon([
  [-width / 2, -height / 2], [width / 2, -height / 2],
  [width / 2, height / 2], [-width / 2, height / 2]
]);
const triangle = () => polygon([[-.34, -.44], [.43, 0], [-.34, .44]]);

export const createMusicPlayIcon = () => {
  const root = new Group(); symbol(root, triangle()); return root;
};
export const createMusicPauseIcon = () => {
  const root = new Group();
  for (const x of [-.23, .23]) symbol(root, rectangle(.25, .88), x);
  return root;
};
export const createMusicStopIcon = () => {
  const root = new Group(); symbol(root, rectangle(.76, .76)); return root;
};
const skip = (previous: boolean) => {
  const root = new Group();
  const arrow = triangle();
  const moving = new Group(); symbol(moving, arrow); moving.scale.set(.82, .82, 1);
  moving.position.x = -.15; root.add(moving);
  symbol(root, rectangle(.18, .84), .44);
  // Flip in the image plane: both faces remain presented toward the camera.
  if (previous) root.scale.x = -1;
  return root;
};
export const createMusicPreviousIcon = () => skip(true);
export const createMusicNextIcon = () => skip(false);

/** One rounded return arrow; its partner is rotated 180 degrees in the image plane. */
const repeatArrow = () => {
  const shape = new Shape();
  shape.moveTo(-.52, -.02); shape.lineTo(-.52, .12);
  shape.quadraticCurveTo(-.52, .44, -.22, .44);
  shape.lineTo(.22, .44); shape.lineTo(.22, .60);
  shape.lineTo(.57, .33); shape.lineTo(.22, .06);
  shape.lineTo(.22, .23); shape.lineTo(-.22, .23);
  shape.quadraticCurveTo(-.31, .23, -.31, .12);
  shape.lineTo(-.31, -.02); shape.closePath();
  return shape;
};
const repeat = (single: boolean) => {
  const root = new Group();
  for (const angle of [0, Math.PI]) {
    const arrow = new Group(); symbol(arrow, repeatArrow()); arrow.rotation.z = angle; root.add(arrow);
  }
  if (single) {
    // Raised serif numeral, geometry rather than text rasterisation or an ambiguous centre dot.
    const one = polygon([[-.13, .10], [-.02, .21], [.09, .21], [.09, -.16],
      [.18, -.16], [.18, -.25], [-.13, -.25], [-.13, -.16], [-.03, -.16], [-.03, .07], [-.13, .01]]);
    put(root, slab(one, .07, .012), surfaces.paper, [0, .025, .16]);
  }
  return root;
};
export const createMusicRepeatIcon = () => repeat(false);
export const createMusicLoopIcon = () => repeat(true);
