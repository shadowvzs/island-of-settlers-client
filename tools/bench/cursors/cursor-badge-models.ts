import * as THREE from "three";

import { at, ball, bar, type CursorMaterials, type Point, ring, slab, tiltedGroup, toScene } from "./cursor-kit";
import { bannerCloth, spearFinial } from "./cursor-tool-models";

/**
 * Order badges drawn at the arrow's lower right (1x pixels around BADGE_CENTER), rendered as their own
 * layer so the dark contour separates them from the arrow.
 */
const BADGE_CENTER: Point = [23.4, 23.2];
const [CX, CY] = BADGE_CENTER;
const offset = (dx: number, dy: number): Point => [CX + dx, CY + dy];
const tilted = (...parts: THREE.Object3D[]) => tiltedGroup(BADGE_CENTER, -.3, -.3).add(...parts);

/** Move: a small blue pennant on a gilded staff, planted where the troops should march. */
export const moveBadge = (materials: CursorMaterials) => {
  const cloth = bannerCloth(offset(-3.6, -6.6), 10.4, 6.6, materials.blueCloth);
  (cloth.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  return tilted(
    bar(offset(-4.4, 7.4), offset(-4.4, -7.6), .8, materials.oak, .6, .7),
    at(spearFinial(materials, 1.05), offset(-4.4, -8.3), .6),
    cloth,
    ball(offset(-4.4, 7.4), .9, materials.iron, .6)
  );
};

/** Retreat: a polished silver return arrow, curving back over the top and down to the left. */
export const retreatBadge = (materials: CursorMaterials) => {
  const arc = (radius: number, from: number, to: number) => Array.from({ length: 19 }, (_, step): Point => {
    const angle = (from + (to - from) * step / 18) * Math.PI;
    return offset(1.6 + Math.cos(angle) * radius, 2 - Math.sin(angle) * radius);
  });
  const outline: Point[] = [...arc(6, 0, 1), offset(-7.2, 2), offset(-2.9, 7.6), offset(1.4, 2), ...arc(2.9, 1, 0)];
  return tilted(slab(outline, materials.steel, materials.bronze, { bevel: .5, depth: .8 }));
};

/** Enter / garrison: an iron-banded oak door in a stone arch. */
export const enterBadge = (materials: CursorMaterials) => {
  const arch = (inset: number): Point[] => [
    offset(-6.4 + inset, 7.6), offset(6.4 - inset, 7.6), offset(6.4 - inset, -1.5),
    ...ring(offset(0, -1.5), 6.4 - inset, 6.4 - inset, 24).filter(([, y]) => y <= CY - 1.5)
      .sort((a, b) => b[0] - a[0]),
    offset(-6.4 + inset, -1.5)
  ];
  const parts: THREE.Object3D[] = [
    slab(arch(0), materials.stone, materials.stone, { bevel: .5, depth: .8 }),
    at(slab(arch(1.6), materials.oak, materials.darkOak, { bevel: .3, depth: .3 }), [0, 0], 1),
    ...[-2.6, 3.4].map(dy => at(slab([offset(-4.6, dy - .55), offset(4.6, dy - .55), offset(4.6, dy + .55),
      offset(-4.6, dy + .55)], materials.iron, materials.iron, { bevel: .2, depth: .2 }), [0, 0], 1.6)),
    ball(offset(2.6, 1.2), .75, materials.gold, 1.9)
  ];
  return tilted(...parts);
};

/** Add to selection: a green enamel plus framed in gold. */
export const addBadge = (materials: CursorMaterials) => crossBadge(materials, materials.greenEnamel, 0);

/** Invalid target: a red enamel cross framed in gold. */
export const invalidBadge = (materials: CursorMaterials) => crossBadge(materials, materials.redEnamel, Math.PI / 4);

const crossBadge = (materials: CursorMaterials, enamel: THREE.Material, angle: number) => {
  const arm = 7, half = 2;
  const outline: Point[] = [[-half, -arm], [half, -arm], [half, -half], [arm, -half], [arm, half], [half, half],
    [half, arm], [-half, arm], [-half, half], [-arm, half], [-arm, -half], [-half, -half]];
  const rotated = outline.map(([x, y]): Point => [CX + x * Math.cos(angle) - y * Math.sin(angle),
    CY + x * Math.sin(angle) + y * Math.cos(angle)]);
  return tilted(slab(rotated, enamel, materials.gold, { bevel: .7, depth: .9 }));
};

/** Board ship: an iron anchor with a gilded ring. */
export const boardBadge = (materials: CursorMaterials) => {
  const fluke = (side: number): Point[] => [offset(side * 6.8, 2), offset(side * 4.8, .6), offset(side * 7.4, -.2)];
  const crown: Point[] = [];
  for (let step = 0; step <= 16; step++) {
    const angle = Math.PI * step / 16;
    crown.push(offset(Math.cos(angle) * 6.2, 1.2 + Math.sin(angle) * 6.2));
  }
  const parts: THREE.Object3D[] = [
    bar(offset(0, -5.2), offset(0, 7.2), 1.1, materials.iron, 1),
    bar(offset(-4.2, -3.6), offset(4.2, -3.6), .85, materials.iron, 1),
    ...crown.slice(1).map((point, index) => bar(crown[index]!, point, 1, materials.iron, 1)),
    slab(fluke(1), materials.iron, materials.iron, { bevel: .3, depth: .6 }),
    slab(fluke(-1), materials.iron, materials.iron, { bevel: .3, depth: .6 }),
    at(new THREE.Mesh(new THREE.TorusGeometry(1.9, .62, 10, 24), materials.gold), offset(0, -7), 1.2)
  ];
  return tilted(...parts);
};

/**
 * Target a unit (targetMilitary): a red enamel reticle ring on a gilded rim, four gilded sight ticks and a red
 * centre stud, beside the attack sword.
 */
export const targetBadge = (materials: CursorMaterials) => {
  const ring = (radius: number, tube: number, material: THREE.Material, depth: number) =>
    at(new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 32), material), offset(0, 0), depth);
  const ticks = ([[0, -1], [0, 1], [-1, 0], [1, 0]] as const).map(([dx, dy]) =>
    bar(offset(dx * 3.2, dy * 3.2), offset(dx * 7.6, dy * 7.6), .9, materials.gold, 1.6));
  return tilted(
    ring(5.6, 1.15, materials.gold, .6),
    ring(5.6, .78, materials.redEnamel, 1.3),
    ...ticks,
    ball(offset(0, 0), 1.25, materials.redEnamel, 1.6)
  );
};

/** Store: an oak crate with iron corner plates. */
export const storeBadge = (materials: CursorMaterials) => {
  const box = new THREE.Mesh(new THREE.BoxGeometry(12, 11, 9), materials.oak);
  box.rotation.set(.38, -.62, 0);
  const group = new THREE.Group();
  group.add(box);
  const [x, y] = toScene(offset(0, 0));
  for (const [px, py] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 9.4), materials.iron);
    plate.position.set(px * 5, py * 4.5, 0);
    box.add(plate);
  }
  for (const py of [-1.8, 1.8]) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(12.2, .5, 9.2), materials.darkOak);
    plank.position.set(0, py, 0);
    box.add(plank);
  }
  group.position.set(x, y, 3);
  return group;
};

/** Siege: a catapult, oak frame on two iron-rimmed wheels with its throwing arm cocked and a stone loaded. */
export const siegeBadge = (materials: CursorMaterials) => {
  const wheel = (dx: number) => {
    const rim = at(new THREE.Mesh(new THREE.TorusGeometry(2.2, .7, 10, 24), materials.iron), offset(dx, 5.2), 1.6);
    const hub = at(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, .8, 16), materials.darkOak), offset(dx, 5.2),
      1.6);
    hub.rotation.x = Math.PI / 2;
    return [rim, hub, ball(offset(dx, 5.2), .7, materials.gold, 2.2)];
  };
  const pivot = offset(3.4, 2.4), cup = offset(-5.6, -5.4);
  const parts: THREE.Object3D[] = [
    bar(offset(-7, 3), offset(7.4, 3), 1.15, materials.oak, 1),
    bar(offset(1.2, 3), offset(1.2, -3), .95, materials.oak, .4),
    bar(offset(-1.4, -3), offset(3.8, -3), .85, materials.darkOak, .8),
    bar(pivot, cup, .9, materials.oak, 1.8, .75),
    at(new THREE.Mesh(new THREE.SphereGeometry(2.1, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), materials.iron),
      cup, 1.8),
    ball(offset(-5.6, -6.3), 1.8, materials.iron, 2),
    ...wheel(-4.4), ...wheel(4.6)
  ];
  return tilted(...parts);
};

/**
 * Sail to (a selected troop ship): a ship's wheel, gilded rim on an oak hub with eight spokes ending in turned
 * handles, mounted on a short oak pedestal.
 */
export const sailBadge = (materials: CursorMaterials) => {
  const hub = offset(.2, -1);
  const spokes = Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4 + Math.PI / 8;
    const tip = (radius: number): Point => [hub[0] + Math.cos(angle) * radius, hub[1] - Math.sin(angle) * radius];
    return [bar(tip(1.2), tip(6.4), .42, materials.oak, 1.2), ball(tip(7), .78, materials.darkOak, 1.2)];
  }).flat();
  const hubDisc = at(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, .9, 18), materials.darkOak), hub, 1.6);
  hubDisc.rotation.x = Math.PI / 2;
  const parts: THREE.Object3D[] = [
    bar(offset(.2, 3.2), offset(.2, 7.6), .95, materials.darkOak, .2),
    bar(offset(-3.2, 7.6), offset(3.6, 7.6), .75, materials.oak, .2),
    ...spokes,
    at(new THREE.Mesh(new THREE.TorusGeometry(4.6, .72, 10, 32), materials.gold), hub, 1.4),
    hubDisc,
    ball(hub, .7, materials.brightGold, 2.2)
  ];
  return tilted(...parts);
};

/** Unload troops: a gilded arrow pointing down onto an oak gangway plank with iron cleats. */
export const unloadBadge = (materials: CursorMaterials) => {
  const arrow: Point[] = [offset(-1.5, -7.4), offset(1.5, -7.4), offset(1.5, -1.4), offset(4.6, -1.4),
    offset(0, 3.6), offset(-4.6, -1.4), offset(-1.5, -1.4)];
  const plank: Point[] = [offset(-7.6, 6.4), offset(7.4, 3.4), offset(7.4, 5.6), offset(-7.6, 8.6)];
  const cleats = [-4.2, -.4, 3.4].map(dx => {
    const y = 6.6 - (dx + 7.6) * .2;
    return bar(offset(dx - .2, y + .9), offset(dx + .2, y - .9), .38, materials.iron, 1.1);
  });
  return tilted(
    slab(plank, materials.oak, materials.darkOak, { bevel: .35, depth: .7 }),
    ...cleats,
    at(slab(arrow, materials.gold, materials.bronze, { bevel: .55, depth: .9 }), [0, 0], 1.4)
  );
};
