import * as THREE from "three";

import {
  at, type CursorMaterials, facetedCap, hotspotMarker, type Point, slab, tiltedGroup
} from "./cursor-kit";

/** Arrow tip of every arrow-based cursor (1x pixels); the CSS hotspot. */
export const ARROW_TIP: Point = [2, 2];

/** Forged arrowhead pointer: a classic cursor silhouette with a socketed stem. */
const ARROW_OUTLINE: readonly Point[] = [
  ARROW_TIP, [2, 22.6], [6.9, 18.1], [10.1, 25.6], [13.8, 24.1], [10.6, 16.9], [17.4, 16.7]
];
const ARROW_APEX: Point = [6.6, 13.1];
const TILT_X = -.32;
const TILT_Y = -.36;
const PLATE = { bevel: .5, depth: .7 };
const CAP_Z = PLATE.depth + PLATE.bevel;

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Dark bronze socket band across the stem, where an arrow shaft would sit. */
const stemCollar = (materials: CursorMaterials) => {
  const [, , barb, stemLeft, stemRight, stemInner] = ARROW_OUTLINE;
  const band = (t: number) => [lerp(barb!, stemLeft!, t), lerp(stemInner!, stemRight!, t)] as const;
  const [nearLeft, nearRight] = band(.56);
  const [farLeft, farRight] = band(.8);
  const widen = (point: Point, toward: Point): Point => lerp(point, toward, -.14);
  const outline = [widen(nearLeft, nearRight), widen(farLeft, farRight), widen(farRight, farLeft),
    widen(nearRight, nearLeft)];
  return at(slab(outline, materials.iron, materials.darkBronze, { bevel: .35, depth: .3 }), [0, 0], CAP_Z - .25);
};

/** Sea-glass gem in a gold bezel: the highlighted ("clickable") arrow. */
const gem = (materials: CursorMaterials) => {
  const group = new THREE.Group();
  const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 0), materials.seaGem);
  stone.scale.set(1, 1, .7);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(3.15, .62, 10, 28), materials.brightGold);
  group.add(at(stone, [0, 0], .9), bezel);
  return at(group, ARROW_APEX, CAP_Z + .4);
};

export type ArrowStyle = "plain" | "highlight";

/** The game's arrow: gilded faces over a bronze rim, tilted so the bevels catch the key and rim lights. */
export const arrowModel = (materials: CursorMaterials, style: ArrowStyle = "plain") => {
  const face = style === "highlight" ? materials.brightGold : materials.gold;
  const plate = slab(ARROW_OUTLINE, face, materials.bronze, PLATE);
  const cap = at(facetedCap(ARROW_OUTLINE, ARROW_APEX, 2.4, face), [0, 0], CAP_Z);
  const parts: THREE.Object3D[] = [plate, cap, stemCollar(materials), hotspotMarker(ARROW_TIP, CAP_Z)];
  if (style === "highlight") parts.push(gem(materials));
  return tiltedGroup(ARROW_TIP, TILT_X, TILT_Y).add(...parts);
};
