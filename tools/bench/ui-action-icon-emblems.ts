import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  MeshPhysicalMaterial,
  OctahedronGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry
} from "three";

import { group, type Paint, paintedMaterial, put, slab, surfaces } from "./ui-action-icon-kit";

/** Corner button emblems: theme medallion (day / night) and the development astrolabe. */

const nightEnamel = () =>
  new MeshPhysicalMaterial({
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    color: "#1d3474",
    metalness: 0.2,
    roughness: 0.3
  });

/** One half of a medallion split by an S curve; `day` takes the left half. */
const medallionHalf = (day: boolean) => {
  const shape = new Shape();
  shape.moveTo(0, 0.5);
  shape.absarc(0, 0, 0.5, Math.PI / 2, -Math.PI / 2, !day);
  shape.absarc(0, -0.25, 0.25, -Math.PI / 2, Math.PI / 2, false);
  shape.absarc(0, 0.25, 0.25, -Math.PI / 2, Math.PI / 2, true);
  return shape;
};

/** Crescent between an outer disc and an offset inner disc (arcs meet at their intersections). */
const crescent = () =>
  new Shape()
    .absarc(0, 0, 0.16, 1.727, 5.905, false)
    .absarc(0.075, 0.06, 0.14, -1.016, 2.366, true);

const addSun = (parent: Group, centre: readonly [number, number]) => {
  const sun = put(parent, new SphereGeometry(0.11, 28, 18), surfaces.sun, [...centre, 0.07]);
  sun.scale.z = 0.55;
  for (let ray = 0; ray < 10; ray++) {
    const angle = (ray / 10) * Math.PI * 2;
    put(
      parent,
      new ConeGeometry(0.03, 0.08, 8),
      surfaces.gold,
      [centre[0] + Math.cos(angle) * 0.17, centre[1] + Math.sin(angle) * 0.17, 0.06],
      [0, 0, angle - Math.PI / 2]
    );
  }
};

/** Theme toggle: a gold and night-blue medallion split by an S curve, sun and crescent moon. */
const theme = () => {
  const root = new Group();
  put(root, slab(medallionHalf(true), 0.08, 0.02), surfaces.gold);
  put(root, slab(medallionHalf(false), 0.08, 0.02), nightEnamel());
  put(root, new TorusGeometry(0.52, 0.05, 14, 72), surfaces.brass);
  addSun(root, [0, -0.25]);
  put(root, slab(crescent(), 0.05, 0.015), surfaces.steel, [-0.02, 0.24, 0.07], [0, 0, 0.5]);
  for (const [x, y, size] of [
    [0.32, -0.06, 0.05],
    [0.36, 0.17, 0.035],
    [0.17, 0.42, 0.03]
  ] as const)
    put(root, new OctahedronGeometry(size), surfaces.gold, [x, y, 0.07]).scale.z = 0.5;
  return root;
};

/** Astrolabe plate: engraved rings, hour lines and a degree scale on polished brass. */
const paintPlate: Paint = (context, width, height) => {
  const centre = width / 2;
  const glow = context.createRadialGradient(centre * 0.8, centre * 0.7, 10, centre, centre, centre);
  glow.addColorStop(0, "#f4d58a");
  glow.addColorStop(1, "#b8862f");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#5c3d12";
  context.lineWidth = 3;
  for (const radius of [0.46, 0.38, 0.24, 0.12]) {
    context.beginPath();
    context.arc(centre, centre, radius * width, 0, Math.PI * 2);
    context.stroke();
  }
  for (let tick = 0; tick < 72; tick++) {
    const angle = (tick / 72) * Math.PI * 2,
      inner = tick % 6 ? 0.42 : 0.39;
    context.lineWidth = tick % 6 ? 1.5 : 3;
    context.beginPath();
    context.moveTo(
      centre + Math.cos(angle) * inner * width,
      centre + Math.sin(angle) * inner * width
    );
    context.lineTo(
      centre + Math.cos(angle) * 0.46 * width,
      centre + Math.sin(angle) * 0.46 * width
    );
    context.stroke();
  }
  context.lineWidth = 2;
  for (let line = 0; line < 12; line++) {
    const angle = (line / 12) * Math.PI * 2;
    context.beginPath();
    context.moveTo(
      centre + Math.cos(angle) * 0.12 * width,
      centre + Math.sin(angle) * 0.12 * width
    );
    context.lineTo(
      centre + Math.cos(angle) * 0.38 * width,
      centre + Math.sin(angle) * 0.38 * width
    );
    context.stroke();
  }
};

/** Open fretwork rete: an offset ecliptic ring and star pointers over the plate. */
const addRete = (parent: Group) => {
  put(parent, new TorusGeometry(0.2, 0.018, 8, 48), surfaces.gold, [0.05, 0.07, 0.06]);
  put(parent, new TorusGeometry(0.31, 0.014, 8, 56), surfaces.gold, [0, 0, 0.055]);
  for (let pointer = 0; pointer < 5; pointer++) {
    const angle = pointer * 1.3 + 0.4;
    put(
      parent,
      new ConeGeometry(0.025, 0.12, 6),
      surfaces.gold,
      [Math.cos(angle) * 0.25, Math.sin(angle) * 0.25, 0.06],
      [0, 0, angle + Math.PI / 2]
    );
  }
};

/** Development tools: a brass astrolabe with throne and ring, rete and a steel alidade. */
const development = () => {
  const root = new Group();
  const plate = paintedMaterial(256, 256, paintPlate, 0.35);
  plate.metalness = 0.55;
  put(
    root,
    new CylinderGeometry(0.42, 0.42, 0.06, 64),
    [surfaces.brass, plate, surfaces.brass],
    [0, 0, 0],
    [Math.PI / 2, 0, 0]
  );
  put(root, new TorusGeometry(0.45, 0.055, 14, 72), surfaces.bronze);
  put(root, new SphereGeometry(0.1, 20, 12), surfaces.bronze, [0, 0.52, 0]).scale.set(1, 0.8, 0.5);
  put(root, new TorusGeometry(0.1, 0.028, 10, 32), surfaces.brass, [0, 0.67, 0], [0, 0.5, 0]);
  addRete(root);
  const alidade = group(root, [0, 0, 0.09], [0, 0, -0.65]);
  put(
    alidade,
    new CylinderGeometry(0.035, 0.035, 0.86, 4),
    surfaces.steel,
    [0, 0, 0],
    [0, 0.78, 0]
  );
  for (const end of [-1, 1])
    put(
      alidade,
      new ConeGeometry(0.035, 0.1, 4),
      surfaces.steel,
      [0, end * 0.48, 0],
      [end > 0 ? 0 : Math.PI, 0.78, 0]
    );
  for (const end of [-1, 1])
    put(
      alidade,
      new CylinderGeometry(0.04, 0.04, 0.03, 16),
      surfaces.iron,
      [0, end * 0.26, 0.03],
      [Math.PI / 2, 0, 0]
    );
  put(
    root,
    new CylinderGeometry(0.05, 0.05, 0.06, 20),
    surfaces.gold,
    [0, 0, 0.12],
    [Math.PI / 2, 0, 0]
  );
  return root;
};

export const UI_EMBLEM_ICONS = { development, theme };
