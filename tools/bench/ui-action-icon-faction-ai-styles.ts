import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  SphereGeometry
} from "three";

import { createToolIconModel } from "../../src/renderers/three/settlement/ware-tool-icon-models";
import { group, paintedMaterial, polygon, put, slab, surfaces } from "./ui-action-icon-kit";

/** Computer faction AI style icons (EAI0c): turtle (tower and shield), balanced, aggressive. */

/** A game tool model (`createToolIconModel`) turned flat to the camera at `roll`. */
const toolAt = (id: string, roll: number, scale: number, position: readonly number[]) => {
  const tool = createToolIconModel(id).root;
  tool.rotation.set(0, 0.2, 0);
  tool.children[0]!.rotation.z = roll;
  tool.scale.setScalar(scale);
  tool.position.set(position[0]!, position[1]!, position[2]!);
  return tool;
};

/** Grey ashlar courses with staggered joints, wrapped around the tower. */
const ashlarMaterial = () => {
  const material = paintedMaterial(128, 64, (context, width, height) => {
    context.fillStyle = "#8d8778";
    context.fillRect(0, 0, width, height);
    for (let row = 0; row < 4; row++)
      for (let block = 0; block < 4; block++) {
        context.fillStyle = (row * 3 + block) % 4 ? "#a8a191" : "#9a9384";
        context.fillRect(block * 32 + (row % 2) * 16 + 2, row * 16 + 2, 28, 12);
      }
  }, 0.9);
  material.map!.wrapS = material.map!.wrapT = RepeatWrapping;
  material.map!.repeat.set(3, 3);
  return material;
};

const heaterShape = () => {
  const shape = new Shape();
  shape.moveTo(-0.26, 0.3);
  shape.lineTo(0.26, 0.3);
  shape.lineTo(0.26, 0.02);
  shape.quadraticCurveTo(0.24, -0.22, 0, -0.36);
  shape.quadraticCurveTo(-0.24, -0.22, -0.26, 0.02);
  shape.closePath();
  return shape;
};

/** A blue enamel heater shield on a gold rim with a gold chevron. */
const addShield = (parent: Group, position: readonly number[]) => {
  const shield = group(parent, position, [0, 0.3, 0.06]);
  const enamel = new MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.12, color: "#1f4fa3", roughness: 0.3 });
  put(shield, slab(heaterShape(), 0.06, 0.02), surfaces.gold, [0, 0, -0.02]);
  const face = put(shield, slab(heaterShape(), 0.04, 0.012), enamel, [0, 0, 0.02]);
  face.scale.set(0.84, 0.86, 1);
  const chevron = polygon([[-0.2, -0.12], [0, 0.1], [0.2, -0.12], [0.2, -0.01], [0, 0.21], [-0.2, -0.01]]);
  put(shield, slab(chevron, 0.02, 0.01), surfaces.gold, [0, -0.04, 0.05]);
};

/** Turtle: a crenellated stone keep with an arrow slit and door, guarded by a heater shield. */
export const createTurtleIcon = () => {
  const root = new Group();
  const stone = ashlarMaterial();
  put(root, new CylinderGeometry(0.3, 0.35, 0.92, 40), stone);
  put(root, new CylinderGeometry(0.38, 0.31, 0.08, 40), surfaces.stone, [0, 0.5, 0]);
  put(root, new CylinderGeometry(0.38, 0.38, 0.1, 40), stone, [0, 0.59, 0]);
  for (let merlon = 0; merlon < 10; merlon++) {
    const angle = (merlon / 10) * Math.PI * 2;
    put(root, new BoxGeometry(0.12, 0.13, 0.1), surfaces.stone,
      [Math.sin(angle) * 0.33, 0.7, Math.cos(angle) * 0.33], [0, angle, 0]);
  }
  const shade = new MeshStandardMaterial({ color: "#000000", opacity: 0.5, roughness: 1, transparent: true });
  for (const side of [-1, 1])
    put(root, new BoxGeometry(0.035, 0.26, 0.04), surfaces.stone, [side * 0.042, 0.18, 0.32]);
  put(root, new BoxGeometry(0.05, 0.22, 0.01), shade, [0, 0.18, 0.318]);
  const door = new Shape().moveTo(-0.1, -0.46).lineTo(0.1, -0.46).lineTo(0.1, -0.2)
    .absarc(0, -0.2, 0.1, 0, Math.PI, false).closePath();
  put(root, slab(door, 0.03, 0.008), surfaces.darkWood, [0, 0, 0.335]);
  addShield(root, [-0.32, -0.2, 0.45]);
  return root;
};

/** Balanced: a sword and a builder's hammer crossed at equal weight. */
export const createBalancedIcon = () => {
  const root = new Group();
  root.add(toolAt("sword", 0.72, 1.1, [0.06, -0.12, 0]));
  root.add(toolAt("hammer", -0.72, 1, [-0.02, 0, 0.08]));
  return root;
};

/** Red war banner: gold trim, a gold sunburst and a swallowtail cut out of the hem. */
const bannerMaterial = () => {
  const material = paintedMaterial(128, 160, (context, width, height) => {
    context.fillStyle = "#e3b23c";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#b3201a";
    context.fillRect(8, 8, width - 16, height - 16);
    context.fillStyle = "#e3b23c";
    context.beginPath();
    for (let point = 0; point < 16; point++) {
      const angle = (point / 16) * Math.PI * 2, radius = point % 2 ? 14 : 34;
      context.lineTo(width / 2 + Math.cos(angle) * radius, height * 0.4 + Math.sin(angle) * radius);
    }
    context.fill();
    context.globalCompositeOperation = "destination-out";
    context.beginPath();
    context.moveTo(width * 0.2, height);
    context.lineTo(width / 2, height * 0.78);
    context.lineTo(width * 0.8, height);
    context.fill();
  }, 0.85);
  material.alphaTest = 0.5;
  material.side = DoubleSide;
  return material;
};

/** A cloth sheet hanging from the crossbar, rippled by the wind. */
const bannerCloth = () => {
  const cloth = new PlaneGeometry(0.68, 0.66, 16, 20);
  const position = cloth.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index), y = position.getY(index);
    position.setZ(index, Math.sin(x * 9 + y * 4) * 0.035 * (0.6 - y));
  }
  cloth.computeVertexNormals();
  return cloth;
};

/** Aggressive: a spear-headed war standard with a red banner, and a sword raised beside it. */
export const createAggressiveIcon = () => {
  const root = new Group();
  const standard = group(root, [-0.12, 0, 0], [0, 0, 0.14]);
  put(standard, new CylinderGeometry(0.03, 0.036, 1.16, 14), surfaces.darkWood, [0, -0.1, 0]);
  const head = polygon([[0, 0.24], [0.08, 0.06], [0.03, -0.04], [-0.03, -0.04], [-0.08, 0.06]]);
  put(standard, slab(head, 0.024, 0.012), surfaces.steel, [0, 0.54, 0]);
  put(standard, new CylinderGeometry(0.045, 0.04, 0.07, 14), surfaces.brass, [0, 0.49, 0]);
  put(standard, new CylinderGeometry(0.02, 0.02, 0.76, 10), surfaces.darkWood, [0.36, 0.38, 0],
    [0, 0, Math.PI / 2]);
  for (const x of [-0.03, 0.75])
    put(standard, new SphereGeometry(0.04, 14, 10), surfaces.gold, [x, 0.38, 0]);
  put(standard, bannerCloth(), bannerMaterial(), [0.36, 0.04, 0.02]);
  root.add(toolAt("sword", -0.42, 1.2, [0.42, -0.22, 0.22]));
  return root;
};
