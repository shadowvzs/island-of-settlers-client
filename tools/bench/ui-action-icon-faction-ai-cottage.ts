import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry
} from "three";

import { createToolIconModel } from "../../src/renderers/three/settlement/ware-tool-icon-models";
import { brickMaterial, group, paintedMaterial, polygon, put, slab, surfaces } from "./ui-action-icon-kit";

/** Maintain: a lived-in half-timbered cottage (smoking chimney) with a repair ladder and a hammer. */

const WALL_WIDTH = 0.9;
const WALL_DEPTH = 0.6;
const WALL_BOTTOM = -0.4;
const WALL_TOP = 0.1;
const GABLE_RISE = 0.3;
const EAVE_OVERHANG = 0.1;

/** Lime plaster between dark oak posts, rails and corner braces. */
const timberFrameMaterial = () => paintedMaterial(128, 96, (context, width, height) => {
  context.fillStyle = "#efe2c2";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#4a2d17";
  for (const x of [0, width / 2 - 4, width - 8]) context.fillRect(x, 0, 8, height);
  context.fillRect(0, 0, width, 8);
  context.fillRect(0, height - 8, width, 8);
  context.lineWidth = 6;
  context.strokeStyle = "#4a2d17";
  context.beginPath();
  context.moveTo(8, height - 8);
  context.lineTo(width / 2 - 4, 8);
  context.moveTo(width - 8, height - 8);
  context.lineTo(width / 2 + 4, 8);
  context.stroke();
}, 0.9);

/** Overlapping terracotta tile courses. */
const roofTileMaterial = () => paintedMaterial(64, 64, (context, width, height) => {
  context.fillStyle = "#b5472a";
  context.fillRect(0, 0, width, height);
  for (let row = 0; row < 8; row++) {
    context.fillStyle = "#7d2b17";
    context.fillRect(0, row * 8 + 6, width, 2);
    for (let tile = 0; tile < 8; tile++) {
      context.fillStyle = (row + tile) % 3 ? "#cc5a33" : "#a63f24";
      context.fillRect(tile * 8 + (row % 2) * 4 + 1, row * 8, 6, 6);
    }
  }
}, 0.65);

const addRoof = (root: Group) => {
  const slope = Math.atan2(GABLE_RISE, WALL_DEPTH / 2);
  const length = (WALL_DEPTH / 2 + EAVE_OVERHANG) / Math.cos(slope);
  const tiles = roofTileMaterial();
  for (const side of [-1, 1]) {
    const centreZ = side * Math.cos(slope) * length / 2 + side * Math.sin(slope) * 0.03;
    const centreY = WALL_TOP + GABLE_RISE - Math.sin(slope) * length / 2 + Math.cos(slope) * 0.03;
    put(root, new BoxGeometry(WALL_WIDTH + 0.16, 0.05, length), tiles, [0, centreY, centreZ],
      [side * slope, 0, 0]);
  }
  put(root, new CylinderGeometry(0.04, 0.04, WALL_WIDTH + 0.2, 16), new MeshStandardMaterial({
    color: "#8f3520", roughness: 0.6
  }), [0, WALL_TOP + GABLE_RISE + 0.05, 0], [0, 0, Math.PI / 2]);
  const gable = polygon([[-WALL_DEPTH / 2, 0], [WALL_DEPTH / 2, 0], [0, GABLE_RISE]]);
  put(root, slab(gable, WALL_WIDTH, 0), new MeshStandardMaterial({ color: "#e6d6b2", roughness: 0.9 }),
    [0, WALL_TOP, 0], [0, Math.PI / 2, 0]);
};

/** Brick stack through the rear roof plane with a stone cap and three rising smoke puffs. */
const addChimney = (root: Group) => {
  put(root, new BoxGeometry(0.13, 0.42, 0.13), brickMaterial(), [0.26, WALL_TOP + 0.28, -0.12]);
  put(root, new BoxGeometry(0.17, 0.04, 0.17), surfaces.stone, [0.26, WALL_TOP + 0.5, -0.12]);
  const smoke = new MeshStandardMaterial({ color: "#d9d6d0", opacity: 0.88, roughness: 1, transparent: true });
  [[0.28, 0.6, 0.07], [0.34, 0.71, 0.09], [0.43, 0.82, 0.11]].forEach(([x, y, radius]) =>
    put(root, new SphereGeometry(radius!, 20, 14), smoke, [x!, WALL_TOP + y!, -0.12]));
};

/** Plank door and a framed window whose shade insert is the shared black 0.5 opacity, behind the reveal. */
const addFrontOpenings = (root: Group) => {
  const front = WALL_DEPTH / 2;
  put(root, new BoxGeometry(0.22, 0.34, 0.03), surfaces.darkWood, [0.17, WALL_BOTTOM + 0.17, front + 0.005]);
  put(root, new BoxGeometry(0.17, 0.3, 0.03), surfaces.wood, [0.17, WALL_BOTTOM + 0.15, front + 0.012]);
  put(root, new SphereGeometry(0.014, 10, 8), surfaces.brass, [0.23, WALL_BOTTOM + 0.15, front + 0.03]);
  const casement = group(root, [-0.22, -0.1, front]);
  put(casement, new PlaneGeometry(0.17, 0.15), new MeshStandardMaterial({
    color: "#000000", opacity: 0.5, roughness: 1, transparent: true
  }), [0, 0, 0.004]);
  for (const [x, y, width, height] of [[0, 0.085, 0.21, 0.025], [0, -0.085, 0.23, 0.03],
    [-0.095, 0, 0.025, 0.19], [0.095, 0, 0.025, 0.19], [0, 0, 0.012, 0.15]] as const)
    put(casement, new BoxGeometry(width, height, 0.035), surfaces.darkWood, [x, y, 0.016]);
};

/** A wooden ladder leaning against the left gable, the visible repair work. */
const addLadder = (root: Group) => {
  const ladder = group(root, [-WALL_WIDTH / 2 - 0.12, -0.08, 0.12], [0, 0, -0.32]);
  for (const side of [-1, 1])
    put(ladder, new CylinderGeometry(0.016, 0.016, 0.72, 8), surfaces.wood, [0, 0, side * 0.06]);
  for (let rung = 0; rung < 5; rung++)
    put(ladder, new CylinderGeometry(0.011, 0.011, 0.12, 8), surfaces.wood, [0, -0.26 + rung * 0.13, 0],
      [Math.PI / 2, 0, 0]);
};

export const createCottage = () => {
  const root = new Group();
  put(root, new BoxGeometry(WALL_WIDTH + 0.08, 0.07, WALL_DEPTH + 0.08), surfaces.stone,
    [0, WALL_BOTTOM - 0.03, 0]);
  put(root, new BoxGeometry(WALL_WIDTH, WALL_TOP - WALL_BOTTOM, WALL_DEPTH), timberFrameMaterial(),
    [0, (WALL_TOP + WALL_BOTTOM) / 2, 0]);
  addRoof(root);
  addChimney(root);
  addFrontOpenings(root);
  addLadder(root);
  const hammer = createToolIconModel("hammer").root;
  hammer.scale.setScalar(0.6);
  hammer.position.set(0.56, -0.3, 0.38);
  root.add(hammer);
  root.userData.iconView = [1.1, 0.75, 2];
  return root;
};
