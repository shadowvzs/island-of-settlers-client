import {
  BoxGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Path,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3
} from "three";

import { paintLeather, paintLeaves, roundedRect } from "./ui-action-icon-book";
import { group, paintedMaterial, put, slab, surfaces } from "./ui-action-icon-kit";

/** Credits: a closed leather book with a gold laurel wreath on its cover and a quill across it. */
const WIDTH = 0.9;
const HEIGHT = 1.16;
const BLOCK = 0.2;
const BOARD = 0.035;
const COVER_Z = BLOCK / 2 + BOARD / 2;
const WREATH_RADIUS = 0.27;
const LEAVES_PER_BRANCH = 9;

const leatherMaterial = () => {
  const leather = paintedMaterial(256, 256, paintLeather, 0.55);
  leather.map!.wrapS = leather.map!.wrapT = RepeatWrapping;
  return leather;
};

/** Front and back boards, the page block between them and the rounded spine with gold bands. */
const addBinding = (book: Group) => {
  const leather = leatherMaterial();
  const board = slab(roundedRect(WIDTH, HEIGHT, 0.035), BOARD * 0.6, BOARD * 0.2);
  for (const side of [-1, 1]) put(book, board, leather, [0, 0, side * COVER_Z]);
  const leaves = paintedMaterial(64, 64, paintLeaves, 0.9);
  put(book, new BoxGeometry(WIDTH - 0.06, HEIGHT - 0.06, BLOCK), leaves, [0.02, 0, 0]);
  const spine = put(book, new CylinderGeometry(0.14, 0.14, HEIGHT, 28), leather, [-WIDTH / 2, 0, 0]);
  spine.scale.set(0.42, 1, 1);
  for (const y of [-0.38, -0.3, 0.3, 0.38]) {
    const band = put(book, new CylinderGeometry(0.145, 0.145, 0.025, 28), surfaces.gold,
      [-WIDTH / 2, y * HEIGHT / 0.8, 0]);
    band.scale.set(0.44, 1, 1.02);
  }
};

/** A tooled gold frame inset along the cover edge. */
const addCoverFrame = (book: Group) => {
  const frame = roundedRect(WIDTH - 0.12, HEIGHT - 0.12, 0.03);
  const inner = roundedRect(WIDTH - 0.16, HEIGHT - 0.16, 0.02);
  frame.holes.push(new Path(inner.getPoints(24)));
  put(book, slab(frame, 0.006, 0.003), surfaces.gold, [0, 0, COVER_Z + BOARD * 0.45]);
};

/** One laurel leaf: a pointed, gently cupped lens. */
const laurelLeaf = () => {
  const leaf = new Shape();
  leaf.moveTo(0, 0);
  leaf.quadraticCurveTo(0.042, 0.05, 0, 0.12);
  leaf.quadraticCurveTo(-0.042, 0.05, 0, 0);
  return slab(leaf, 0.008, 0.005);
};

/** One branch of the wreath: a curved stem with paired leaves, rising from the bow. */
const addBranch = (wreath: Group, side: number, leaf: ReturnType<typeof laurelLeaf>) => {
  const arc = (step: number) => -Math.PI / 2 + side * (0.25 + step * 2.45);
  const stem = new CatmullRomCurve3(Array.from({ length: 8 }, (_, index) => {
    const angle = arc(index / 7);
    return new Vector3(Math.cos(angle) * WREATH_RADIUS, Math.sin(angle) * WREATH_RADIUS, 0);
  }));
  put(wreath, new TubeGeometry(stem, 32, 0.008, 6), surfaces.gold);
  for (let index = 0; index < LEAVES_PER_BRANCH; index++) {
    const step = (index + 0.5) / LEAVES_PER_BRANCH;
    const angle = arc(step), tangent = angle + side * Math.PI / 2;
    const size = 1 - step * 0.35;
    for (const spread of [-0.55, 0.55]) {
      const mesh = put(wreath, leaf, surfaces.gold,
        [Math.cos(angle) * WREATH_RADIUS, Math.sin(angle) * WREATH_RADIUS, 0.004],
        [0, 0, tangent - Math.PI / 2 + spread * side]);
      mesh.scale.setScalar(size);
    }
  }
};

/** Gold laurel wreath tied with a bow, with a small gold star in its middle. */
const addWreath = (book: Group) => {
  const wreath = group(book, [0, 0.04, COVER_Z + BOARD * 0.5]);
  const leaf = laurelLeaf();
  for (const side of [-1, 1]) addBranch(wreath, side, leaf);
  for (const side of [-1, 1]) {
    const loop = put(wreath, new TorusGeometry(0.03, 0.01, 8, 20), surfaces.wax,
      [side * 0.03, -WREATH_RADIUS, 0.012]);
    loop.scale.set(1, 0.6, 1);
  }
  put(wreath, new SphereGeometry(0.016, 12, 8), surfaces.wax, [0, -WREATH_RADIUS, 0.016]);
  const star = new Shape();
  for (let point = 0; point < 10; point++) {
    const radius = point % 2 ? 0.045 : 0.11, angle = Math.PI / 2 + (point * Math.PI) / 5;
    star[point ? "lineTo" : "moveTo"](Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  put(wreath, slab(star, 0.012, 0.006), surfaces.gold, [0, 0.01, 0.006]);
};

/** Fine barbs angled up and away from the shaft, with a soft grey sheen at the tips. */
const vaneMaterial = () => {
  const vane = paintedMaterial(64, 64, (context, width, height) => {
    context.fillStyle = "#f6f0e2";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#b3a68c";
    context.lineWidth = 1.2;
    for (let line = -height; line < width + height; line += 6) {
      context.beginPath();
      context.moveTo(line, height);
      context.lineTo(line + height * 0.6, 0);
      context.stroke();
    }
  }, 0.8);
  vane.side = DoubleSide;
  vane.map!.wrapS = vane.map!.wrapT = RepeatWrapping;
  vane.map!.repeat.set(12, 12);
  return vane;
};

/** One side of the feather: widest near the top, tapering to the tip and down to the bare quill. */
const vaneShape = (side: number) => {
  const shape = new Shape();
  shape.moveTo(0, -0.3);
  shape.quadraticCurveTo(side * 0.11, -0.05, side * 0.1, 0.3);
  shape.lineTo(side * 0.075, 0.33);
  shape.lineTo(side * 0.1, 0.42);
  shape.quadraticCurveTo(side * 0.08, 0.68, 0.04, 0.76);
  shape.quadraticCurveTo(0.03, 0.3, 0, -0.3);
  return shape;
};

/** A white goose quill: curved shaft, a barbed vane on both sides and a brass nib. */
const addQuill = (root: Group) => {
  const quill = group(root, [0.38, -0.18, 0.42], [0.25, -0.2, -0.62]);
  quill.scale.setScalar(0.82);
  const shaft = new CatmullRomCurve3([
    new Vector3(0, -0.72, 0), new Vector3(0.02, 0, 0.03), new Vector3(0.05, 0.74, 0.01)
  ]);
  put(quill, new TubeGeometry(shaft, 40, 0.012, 8), surfaces.paper);
  const vane = vaneMaterial();
  for (const side of [-1, 1])
    put(quill, slab(vaneShape(side), 0.003, 0.002), vane, [0.02, 0, 0.025], [0, side * 0.15, 0]);
  put(quill, new ConeGeometry(0.016, 0.1, 12), surfaces.brass, [0, -0.77, 0], [Math.PI, 0, 0]);
};

export const createCreditsBook = () => {
  const root = new Group();
  const book = group(root, [0, 0, 0], [-0.5, -0.38, 0.06]);
  addBinding(book);
  addCoverFrame(book);
  addWreath(book);
  addQuill(root);
  return root;
};
