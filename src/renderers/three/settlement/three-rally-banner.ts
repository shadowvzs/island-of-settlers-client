import {
  BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh,
  MeshStandardMaterial, SphereGeometry, TorusGeometry
} from "three";

import {
  blendPlayerFlagVertex, PLAYER_FLAG_POSES, playerFlagWindWeights
} from "../../../render-common/buildings/player-flag-motion";
import type { RallyBannerFrame } from "../../../render-common/renderer-contract";
import { DEFAULT_PLAYER_COLOR } from "../../../render-common/settlement/player-color";
import { createPlayerFlagClothWeave } from "../buildings/roman-player-flag";

/** Banner units: the cloth motion is authored for a 0.43 x 0.27 flag; the group is scaled up. */
const POLE_HEIGHT = 1.08;
const POLE_RADIUS = .022;
const BANNER_SCALE = 2.4;
const CLOTH_WIDTH = .43;
const CLOTH_TOP = .385;
const CLOTH_HEIGHT = .27;
/** A war banner's cloth is larger than the HQ pennant the motion was authored for. */
const CLOTH_SCALE = 1.7;
/** The cloth's top edge hangs just under the finial collar. */
const CLOTH_HOIST = POLE_HEIGHT - .05;
const TRIM_COLOR = [.86, .66, .26] as const;

/** A border of gold on the free edge, top and bottom rows (High only: Minimal is too coarse). */
const isTrim = (row: number, column: number, rows: number, columns: number) =>
  row === 0 || row === rows || column === columns;

const createClothGeometry = (columns: number, rows: number) => {
  const geometry = new BufferGeometry();
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    vertices.push(0, 0, 0); uvs.push(column / columns, 1 - row / rows);
    if (row === rows || column === columns) continue;
    const a = row * (columns + 1) + column, b = a + columns + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(vertices.length), 3));
  geometry.setIndex(indices);
  return geometry;
};

/** Vertex colours: the player's colour, with the gold border on High (the cloth material is white). */
const paintCloth = (geometry: BufferGeometry, columns: number, rows: number, trimmed: boolean,
  color: readonly [number, number, number]) => {
  const colors = geometry.getAttribute("color");
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const paint = trimmed && isTrim(row, column, rows, columns) ? TRIM_COLOR : color;
    colors.setXYZ(row * (columns + 1) + column, paint[0], paint[1], paint[2]);
  }
  colors.needsUpdate = true;
};

/** Writes the cloth shape for the given wind pose weights (all zero: the calm hang). */
const shapeCloth = (geometry: BufferGeometry, columns: number, rows: number, weights: readonly number[]) => {
  const positions = geometry.getAttribute("position"), point: number[] = [0, 0, 0];
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    blendPlayerFlagVertex(column / columns * CLOTH_WIDTH, CLOTH_TOP - row / rows * CLOTH_HEIGHT, weights, point);
    positions.setXYZ(row * (columns + 1) + column, point[0]!, point[1]! - CLOTH_TOP, point[2]!);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
};

const createPole = (detailed: boolean) => {
  const segments = detailed ? 10 : 5;
  const wood = new MeshStandardMaterial({ color: 0x6b4527, roughness: .78 });
  const gold = new MeshStandardMaterial({ color: 0xc9a046, roughness: .35, metalness: .7 });
  const shaft = new Mesh(new CylinderGeometry(POLE_RADIUS * .85, POLE_RADIUS, POLE_HEIGHT, segments), wood);
  shaft.position.y = POLE_HEIGHT / 2;
  const tip = new Mesh(new ConeGeometry(POLE_RADIUS * 1.6, .11, detailed ? 8 : 4), gold);
  tip.position.y = POLE_HEIGHT + .075;
  const parts: Mesh[] = [shaft, tip];
  if (detailed) {
    const knob = new Mesh(new SphereGeometry(POLE_RADIUS * 1.5, 10, 8), gold);
    knob.position.y = POLE_HEIGHT + .01;
    const collar = new Mesh(new TorusGeometry(POLE_RADIUS * 1.15, POLE_RADIUS * .35, 6, 12), gold);
    collar.rotation.x = Math.PI / 2; collar.position.y = POLE_HEIGHT - .04;
    parts.push(knob, collar);
  }
  return { parts, materials: [wood, gold] };
};

/**
 * The persistent rally banner: a wooden pole with a gilded spear tip and a cloth in the player's
 * colour. High waves the cloth in the wind (12 x 6 cloth, gold trim); Minimal keeps a still 4 x 2
 * cloth shaped once, so it costs nothing per frame.
 */
export const createThreeRallyBanner = (detailed: boolean) => {
  const root = new Group(); root.name = "military-rally-banner"; root.visible = false;
  root.scale.setScalar(BANNER_SCALE);
  const columns = detailed ? 12 : 4, rows = detailed ? 6 : 2;
  const geometry = createClothGeometry(columns, rows);
  const weave = createPlayerFlagClothWeave();
  const cloth = new MeshStandardMaterial({ map: weave, roughness: .9, side: DoubleSide, vertexColors: true });
  let painted = "";
  const paint = (color: readonly [number, number, number]) => {
    const key = color.join();
    if (key === painted) return;
    painted = key; paintCloth(geometry, columns, rows, detailed, color);
  };
  paint(DEFAULT_PLAYER_COLOR);
  const pole = createPole(detailed);
  const flag = new Mesh(geometry, cloth);
  flag.position.set(POLE_RADIUS, CLOTH_HOIST, 0); flag.scale.setScalar(CLOTH_SCALE);
  root.add(flag, ...pole.parts);
  const weights = new Array<number>(PLAYER_FLAG_POSES).fill(0);
  // A still Minimal cloth hangs in a mid-gust pose, so it still reads as a flag in the wind.
  playerFlagWindWeights(1.3, .6, weights);
  shapeCloth(geometry, columns, rows, weights);
  return {
    root,
    /** `wind`: strength and heading (radians, atan2 of the wind's z and x); the cloth streams downwind. */
    update: (banner: RallyBannerFrame | null | undefined, time: number,
      wind: { direction: number; strength: number }, color: readonly [number, number, number]) => {
      root.visible = Boolean(banner);
      if (!banner) return;
      root.position.set(banner.x, banner.y, banner.z);
      root.rotation.y = -wind.direction;
      paint(color);
      if (!detailed) return;
      playerFlagWindWeights(time, wind.strength, weights);
      shapeCloth(geometry, columns, rows, weights);
    },
    dispose: () => {
      geometry.dispose(); weave.dispose(); cloth.dispose();
      for (const part of pole.parts) part.geometry.dispose();
      for (const material of pole.materials) material.dispose();
    }
  };
};
