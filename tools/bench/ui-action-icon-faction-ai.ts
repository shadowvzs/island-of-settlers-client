import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  MeshStandardMaterial,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3
} from "three";

import { createCottage } from "./ui-action-icon-faction-ai-cottage";
import {
  createAggressiveIcon,
  createBalancedIcon,
  createTurtleIcon
} from "./ui-action-icon-faction-ai-styles";
import { group, paintedMaterial, put, rockGeometry, slab, surfaces } from "./ui-action-icon-kit";

/**
 * Map-editor Computer faction AI icons (EAI0c), rendered by `ui-action-icons.ts --set=ai` into
 * `assets/ui-icons/ai/<name>.webp`. Modes: none (barred, padlocked gate), maintain (lived-in cottage
 * under repair), develop (sapling beside rising coin stacks). Styles: `ui-action-icon-faction-ai-styles.ts`.
 */

const DOOR_HALF_WIDTH = 0.36;
const DOOR_BOTTOM = -0.5;
const DOOR_SPRING = 0.08;

/** Vertical oak planks with dark seams and grain streaks (four planks per shape unit). */
const plankMaterial = () => {
  const material = paintedMaterial(64, 64, (context, width, height) => {
    context.fillStyle = "#a0662f";
    context.fillRect(0, 0, width, height);
    for (let streak = 0; streak < 40; streak++) {
      context.fillStyle = streak % 2 ? "#8a552a" : "#b67b42";
      context.fillRect((streak * 13.7) % width, 0, 1 + (streak % 3), height);
    }
    context.fillStyle = "#3e2412";
    context.fillRect(0, 0, 4, height);
  }, 0.7);
  material.map!.wrapS = material.map!.wrapT = RepeatWrapping;
  material.map!.repeat.set(4, 1);
  return material;
};

/** Round-topped outline: straight jambs up to the springing line, then a half circle. */
const archShape = (halfWidth: number, bottom: number) => {
  const shape = new Shape();
  shape.moveTo(-halfWidth, bottom);
  shape.lineTo(halfWidth, bottom);
  shape.lineTo(halfWidth, DOOR_SPRING);
  shape.absarc(0, DOOR_SPRING, halfWidth, 0, Math.PI, false);
  shape.closePath();
  return shape;
};

/** Dressed stone jambs and arch voussoirs framing the door opening. */
const addStoneArch = (root: Group) => {
  const stone = new MeshStandardMaterial({ color: "#a29a8a", flatShading: true, roughness: 0.85 });
  const radius = DOOR_HALF_WIDTH + 0.09;
  for (let course = 0; course < 4; course++)
    for (const side of [-1, 1]) {
      const block = put(root, rockGeometry(course * 3 + side, 1), stone,
        [side * radius, DOOR_BOTTOM + 0.08 + course * 0.15, 0]);
      block.scale.set(0.1, 0.075, 0.1);
    }
  for (let piece = 0; piece <= 6; piece++) {
    const angle = (piece / 6) * Math.PI;
    const block = put(root, new BoxGeometry(0.17, 0.13, 0.2), stone,
      [Math.cos(angle) * radius, DOOR_SPRING + Math.sin(angle) * radius, 0], [0, 0, angle - Math.PI / 2]);
    block.scale.x = piece === 3 ? 1.2 : 1;
  }
};

/** A brass padlock: rounded body, keyhole and a steel shackle through the bar's hasp. */
const addPadlock = (parent: Group, position: readonly number[]) => {
  const lock = group(parent, position);
  lock.scale.setScalar(1.6);
  const body = new Shape();
  body.moveTo(-0.09, 0.05);
  body.lineTo(0.09, 0.05);
  body.lineTo(0.09, -0.06);
  body.quadraticCurveTo(0, -0.13, -0.09, -0.06);
  body.closePath();
  put(lock, slab(body, 0.05, 0.02), surfaces.brass);
  put(lock, new TorusGeometry(0.06, 0.018, 10, 24, Math.PI), surfaces.steel, [0, 0.07, 0]);
  put(lock, new CylinderGeometry(0.018, 0.018, 0.03, 12), surfaces.darkWood, [0, -0.025, 0.05],
    [Math.PI / 2, 0, 0]);
};

/** None: a shut plank gate in a stone arch, iron straps, a heavy crossbar and a padlock. */
const none = () => {
  const root = new Group();
  const shadow = new MeshStandardMaterial({ color: "#2b1c10", roughness: 1 });
  put(root, slab(archShape(DOOR_HALF_WIDTH + 0.02, DOOR_BOTTOM), 0.02, 0), shadow, [0, 0, -0.06]);
  put(root, slab(archShape(DOOR_HALF_WIDTH, DOOR_BOTTOM), 0.08, 0.012), plankMaterial());
  addStoneArch(root);
  for (const y of [-0.34, 0.24]) {
    put(root, new BoxGeometry(0.66, 0.05, 0.02), surfaces.iron, [-0.02, y, 0.06]);
    for (const x of [-0.24, -0.04, 0.16])
      put(root, new SphereGeometry(0.018, 10, 8), surfaces.steel, [x, y, 0.075]);
  }
  for (const side of [-1, 1])
    put(root, new BoxGeometry(0.1, 0.17, 0.12), surfaces.iron, [side * (DOOR_HALF_WIDTH + 0.02), -0.08, 0.11]);
  put(root, new BoxGeometry(1.04, 0.14, 0.1), surfaces.darkWood, [0, -0.08, 0.16], [0, 0, -0.03]);
  addPadlock(root, [0.04, -0.28, 0.24]);
  return root;
};

/** One gold coin with a raised rim; `tilt` gives a slightly irregular stack. */
const addCoin = (parent: Group, position: readonly number[], tilt: number) => {
  const coin = group(parent, position, [tilt, 0, tilt * 0.6]);
  put(coin, new CylinderGeometry(0.15, 0.15, 0.045, 36), surfaces.gold);
  put(coin, new TorusGeometry(0.135, 0.012, 8, 36), surfaces.brass, [0, 0.024, 0], [Math.PI / 2, 0, 0]);
};

/** A pointed leaf blade with a darker midrib, bent outward from its stem. */
const leafGeometry = () => {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.08, 0.08, 0, 0.22);
  shape.quadraticCurveTo(-0.08, 0.08, 0, 0);
  return slab(shape, 0.01, 0.006);
};

/** A young tree: curved trunk, side shoots and broad bright leaves. */
const addSapling = (parent: Group, base: readonly number[]) => {
  const sapling = group(parent, base);
  const bark = new MeshStandardMaterial({ color: "#6b4426", roughness: 0.8 });
  const leaf = new MeshStandardMaterial({ color: "#5cb032", roughness: 0.55 });
  const trunk = new CatmullRomCurve3([
    new Vector3(0, 0, 0), new Vector3(0.03, 0.25, 0), new Vector3(-0.02, 0.5, 0.02), new Vector3(0.02, 0.68, 0)
  ]);
  put(sapling, new TubeGeometry(trunk, 16, 0.028, 10), bark);
  const leaves = [
    [0.02, 0.68, 0, 0], [0, 0.6, 0.1, 0.9], [0, 0.6, -0.1, -0.9], [-0.02, 0.45, 0.2, 1.4],
    [-0.02, 0.42, -0.2, -1.3], [0.03, 0.27, 0.3, 1.7], [0.03, 0.25, -0.3, -1.8]
  ] as const;
  for (const [x, y, lean, turn] of leaves) {
    const blade = put(sapling, leafGeometry(), leaf, [x, y, 0], [0.25, turn * 0.4, -turn * 0.75 - lean]);
    blade.scale.setScalar(1.7);
  }
  const mound = put(sapling, new SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), surfaces.soil);
  mound.scale.y = 0.4;
};

/** Develop: a sapling growing beside three gold coin stacks that rise left to right. */
const develop = () => {
  const root = new Group();
  [4, 7, 11].forEach((count, stack) => {
    for (let coin = 0; coin < count; coin++)
      addCoin(root, [-0.08 + stack * 0.27, -0.28 + coin * 0.05, -0.1 - stack * 0.1], ((coin * 7) % 3 - 1) * 0.025);
  });
  addSapling(root, [-0.3, -0.32, 0.25]);
  root.userData.iconView = [0.6, 0.9, 2];
  return root;
};

export const UI_FACTION_AI_ICONS: Record<string, () => Group> = {
  aggressive: createAggressiveIcon,
  balanced: createBalancedIcon,
  develop,
  maintain: createCottage,
  none,
  turtle: createTurtleIcon
};
