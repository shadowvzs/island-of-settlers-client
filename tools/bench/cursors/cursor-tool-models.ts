import * as THREE from "three";

import {
  along, at, ball, bar, type CursorMaterials, facetedCap, hotspotMarker, type Point, slab, tiltedGroup, toScene
} from "./cursor-kit";

/** Sword tip (1x pixels): the attack hotspot. */
export const SWORD_TIP: Point = [2, 2];
/** Foot of the rally standard's pole (1x pixels): where the banner is planted. */
export const STANDARD_FOOT: Point = [3, 30];

const DIAGONAL: Point = [Math.SQRT1_2, Math.SQRT1_2];
const BLADE_LENGTH = 16.5;

/** Steel blade with a forged ridge, gilded cross guard, leather grip and pommel, tip at the hotspot. */
export const swordModel = (materials: CursorMaterials) => {
  const point = (distance: number, across = 0) => along(SWORD_TIP, DIAGONAL, distance, across);
  const blade: Point[] = [point(0), point(3.4, 1.75), point(BLADE_LENGTH, 1.75), point(BLADE_LENGTH, -1.75),
    point(3.4, -1.75)];
  const guard: Point[] = [point(BLADE_LENGTH - .2, 5.4), point(BLADE_LENGTH + 1.5, 5.6), point(BLADE_LENGTH + 1.8, 0),
    point(BLADE_LENGTH + 1.5, -5.6), point(BLADE_LENGTH - .2, -5.4), point(BLADE_LENGTH + .4, 0)];
  const parts: THREE.Object3D[] = [
    slab(blade, materials.steel, materials.steel, { bevel: .3, depth: .3 }),
    at(facetedCap(blade, point(BLADE_LENGTH - 1, 0), .9, materials.steel), [0, 0], .6),
    at(slab(guard, materials.gold, materials.bronze, { bevel: .45, depth: .7 }), [0, 0], -.1),
    bar(point(BLADE_LENGTH + 1.6), point(BLADE_LENGTH + 6.6), 1.15, materials.leather, .8, 1.05),
    ...[2.6, 4.3].map(distance => bar(point(BLADE_LENGTH + distance), point(BLADE_LENGTH + distance + .5), 1.3,
      materials.bronze, .8)),
    ball(point(BLADE_LENGTH + 8.3), 1.95, materials.gold, .8),
    ...[5.5, -5.5].map(across => ball(point(BLADE_LENGTH + .8, across), .9, materials.gold, .9)),
    hotspotMarker(SWORD_TIP, .9)
  ];
  return tiltedGroup(SWORD_TIP, -.3, -.3).add(...parts);
};

/** Swallowtail cloth on a pole, rippled in the wind; `width`/`height` in cursor pixels from `corner`. */
export const bannerCloth = (corner: Point, width: number, height: number, material: THREE.Material) => {
  const [x, y] = toScene(corner);
  const tail = width * .26;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(width, 0); shape.lineTo(width - tail, -height / 2);
  shape.lineTo(width, -height); shape.lineTo(0, -height); shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 12);
  const position = geometry.attributes.position!;
  for (let index = 0; index < position.count; index++) {
    const u = position.getX(index) / width;
    position.setZ(index, Math.sin(u * 5.4) * .9 * u);
  }
  geometry.computeVertexNormals();
  const cloth = new THREE.Mesh(geometry, material);
  cloth.position.set(x, y, 0);
  return cloth;
};

/** Gilded, four-sided spear point that crowns a staff. */
export const spearFinial = (materials: CursorMaterials, size = 1.5) => {
  const point = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0), materials.gold);
  point.scale.set(1, 1.8, 1);
  point.rotation.y = Math.PI / 4;
  return point;
};

/** The rally standard: oak pole with a gilded spear finial, a red swallowtail with gold trim and boss. */
export const standardModel = (materials: CursorMaterials) => {
  const [footX, footY] = STANDARD_FOOT;
  const top: Point = [footX, 4];
  const cloth = bannerCloth([footX + .9, 5.4], 17, 10.5, materials.cloth);
  (cloth.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const parts: THREE.Object3D[] = [
    bar([footX, footY - .5], top, .95, materials.oak, .4, .8),
    at(spearFinial(materials), [footX, 2.6], .4),
    bar([footX - .2, 5.2], [footX + 15.4, 5.2], .45, materials.gold, .5),
    at(cloth, [0, 0], .4),
    ball([footX + 7.5, 10.5], 1.9, materials.gold, 1.6),
    ball([footX, footY - .6], 1.1, materials.iron, .4),
    hotspotMarker(STANDARD_FOOT, .4)
  ];
  return tiltedGroup(STANDARD_FOOT, -.18, -.32).add(...parts);
};

/** Leather gauntlet with a bronze cuff; `closed` curls the fingers into a fist (the grabbing cursor). */
export const gauntletModel = (materials: CursorMaterials, closed: boolean) => {
  const palm: Point[] = [[9, 13.5], [22, 13.5], [23, 23], [19.5, 27.5], [11.5, 27.5], [8.5, 22]];
  const parts: THREE.Object3D[] = [
    slab(palm, materials.leather, materials.darkOak, { bevel: 1.4, depth: 1.2, segments: 4 }),
    slab([[10.5, 26.6], [20.5, 26.6], [20.5, 30.4], [10.5, 30.4]], materials.bronze, materials.darkBronze,
      { bevel: .6, depth: 1.4 })
  ];
  const fingerBases: Point[] = [[10.6, 13.6], [14.2, 12.8], [17.8, 12.8], [21.2, 13.8]];
  const fingerLengths = [6.6, 8.6, 8.4, 6.6];
  fingerBases.forEach((base, index) => {
    const spread = (index - 1.5) * .09;
    const length = closed ? 2.4 : fingerLengths[index]!;
    const tip: Point = [base[0] + Math.sin(spread) * length, base[1] - Math.cos(spread) * length];
    parts.push(bar(base, tip, 1.55, materials.leather, closed ? 3.2 : 1.9, 1.35));
    parts.push(ball(tip, closed ? 1.7 : 1.35, materials.leather, closed ? 3.4 : 1.9));
    parts.push(ball(base, 1.05, materials.bronze, 3.3));
  });
  const thumbTip: Point = closed ? [14.5, 19.8] : [4.2, 13.8];
  const thumbBase: Point = closed ? [9.6, 21.4] : [9.4, 21.6];
  parts.push(bar(thumbBase, thumbTip, 1.75, materials.leather, 3, 1.45), ball(thumbTip, 1.5, materials.leather, 3));
  parts.push(hotspotMarker([16, 18], 2));
  return tiltedGroup([16, 18], -.22, -.25).add(...parts);
};
