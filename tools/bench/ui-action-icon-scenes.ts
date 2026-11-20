import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusGeometry
} from "three";

import {
  group,
  type Paint,
  paintedMaterial,
  polygon,
  put,
  rockGeometry,
  slab,
  surfaces,
  tileSurfaces
} from "./ui-action-icon-kit";

/** Ground tiles and document compositions for the UI action icons. */
const ROAD_HALF_WIDTH = 0.17;
/** Sideways offset of the winding road centre at a tile depth (-.5 .. .5). */
const roadOffset = (z: number) => 0.13 * Math.sin(z * Math.PI * 1.6);

const paintGrass = (context: CanvasRenderingContext2D, width: number, height: number) => {
  context.fillStyle = "#3f7a26";
  context.fillRect(0, 0, width, height);
  for (let tuft = 0; tuft < 900; tuft++) {
    context.fillStyle = tuft % 3 ? "#4d8c2e" : "#2f6420";
    context.fillRect((tuft * 37.7) % width, (tuft * 53.3) % height, 2, 5);
  }
};

const paintRoad =
  (paved: boolean): Paint =>
  (context, width, height) => {
    paintGrass(context, width, height);
    for (let row = 0; row < height; row++) {
      const centre = (0.5 + roadOffset(row / height - 0.5)) * width,
        half = ROAD_HALF_WIDTH * width;
      context.fillStyle = paved ? "#4e4a43" : "#8b5d33";
      context.fillRect(centre - half - 3, row, half * 2 + 6, 1);
      if (paved) continue;
      context.fillStyle = "#a8774a";
      context.fillRect(centre - half * 0.35, row, half * 0.7, 1);
      context.fillStyle = "#5a3a1f";
      for (const rut of [-0.55, 0.55]) context.fillRect(centre + rut * half - 3, row, 6, 1);
    }
    if (paved) return;
    for (let clod = 0; clod < 160; clod++) {
      const row = (clod * 29.3) % height,
        centre = (0.5 + roadOffset(row / height - 0.5)) * width;
      context.fillStyle = clod % 2 ? "#6e4627" : "#b08354";
      context.fillRect(
        centre + ((((clod * 17) % 60) - 30) / 60) * ROAD_HALF_WIDTH * width * 1.6,
        row,
        4,
        3
      );
    }
  };

const COBBLE_TONES = ["#9a9284", "#8a8478", "#b0a796", "#7d776c"];

const addCobbles = (tile: Group) => {
  const tones = COBBLE_TONES.map(
    (color) => new MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 })
  );
  for (let row = 0; row < 10; row++)
    for (let column = 0; column < 3; column++) {
      const z = (row - 4.5) * 0.098,
        x = roadOffset(z) + (column - 1 + (row % 2) * 0.25 - 0.12) * 0.11;
      const cobble = put(
        tile,
        rockGeometry(row * 3 + column, 1),
        tones[(row + column) % tones.length]!,
        [x, 0.09, z]
      );
      cobble.scale.set(0.05, 0.028, 0.045);
    }
  for (const side of [-1, 1])
    for (let step = 0; step < 12; step++) {
      const z = (step - 5.5) * 0.083;
      put(
        tile,
        new BoxGeometry(0.035, 0.04, 0.08),
        tones[3]!,
        [roadOffset(z) + side * (ROAD_HALF_WIDTH + 0.01), 0.09, z],
        [0, Math.cos(z * Math.PI * 1.6) * 0.4, 0]
      );
    }
};

const addRoadside = (tile: Group) => {
  for (let pebble = 0; pebble < 6; pebble++) {
    const side = pebble % 2 ? 1 : -1,
      z = (pebble - 2.5) * 0.16;
    const stone = put(tile, rockGeometry(pebble + 7), surfaces.stone, [
      roadOffset(z) + side * (0.3 + pebble * 0.015),
      0.09,
      z
    ]);
    stone.scale.setScalar(0.03 + (pebble % 3) * 0.01);
  }
};

/** Dirt road / stone road upgrade: a grass tile with a winding rutted track or a cobbled, kerbed road. */
export const createRoadTile = (paved: boolean) => {
  const root = new Group();
  const tile = group(root, [0, 0, 0], [0, 0.35, 0]);
  put(
    tile,
    new BoxGeometry(1, 0.14, 1),
    tileSurfaces(paintedMaterial(256, 256, paintRoad(paved), 0.95))
  );
  if (paved) addCobbles(tile);
  addRoadside(tile);
  return root;
};

const addFlag = (parent: Group, position: readonly number[], color: string, height: number) => {
  const flag = group(parent, position);
  put(flag, new CylinderGeometry(0.018, 0.022, height, 10), surfaces.wood, [0, height / 2, 0]);
  const cloth = paintedMaterial(
    8,
    8,
    (context) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 8, 8);
    },
    0.6
  );
  cloth.side = DoubleSide;
  const banner = put(flag, new PlaneGeometry(0.22, 0.15, 6, 2), cloth, [0.11, height - 0.09, 0]);
  const position3 = banner.geometry.getAttribute("position");
  for (let index = 0; index < position3.count; index++)
    position3.setZ(index, Math.sin(position3.getX(index) * 18) * 0.015);
  banner.geometry.computeVertexNormals();
  return flag;
};

/** Territory: a round island plot ringed by border stones, claimed by a red banner. */
export const createTerritoryTile = () => {
  const root = new Group();
  put(root, new CylinderGeometry(0.55, 0.5, 0.14, 48), [
    surfaces.soil,
    surfaces.grass,
    surfaces.soil
  ]);
  for (let marker = 0; marker < 14; marker++) {
    const angle = (marker / 14) * Math.PI * 2;
    const stone = put(root, rockGeometry(marker), surfaces.stone, [
      Math.cos(angle) * 0.46,
      0.1,
      Math.sin(angle) * 0.46
    ]);
    stone.scale.set(0.05, 0.06, 0.05);
  }
  addFlag(root, [0, 0.07, 0], "#b71f22", 0.85).scale.setScalar(1.4);
  return root;
};

/** Aged parchment: a warm sheet browned towards a scorched edge, with dark ink lines. */
const paintLetter: Paint = (context, width, height) => {
  const tone = context.createRadialGradient(
    width * 0.45, height * 0.4, width * 0.1,
    width / 2, height / 2, width * 0.75
  );
  tone.addColorStop(0, "#e6c98d");
  tone.addColorStop(0.65, "#c99a5a");
  tone.addColorStop(1, "#7a4c22");
  context.fillStyle = tone;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#5a3517";
  context.lineWidth = 5;
  context.strokeRect(2, 2, width - 4, height - 4);
  context.fillStyle = "#3b2414";
  for (let line = 0; line < 5; line++)
    context.fillRect(
      width * 0.16,
      height * (0.18 + line * 0.11),
      width * (line % 2 ? 0.6 : 0.68),
      6
    );
};

const arrowShape = () =>
  polygon([
    [-0.32, 0.11],
    [0.06, 0.11],
    [0.06, 0.27],
    [0.38, 0],
    [0.06, -0.27],
    [0.06, -0.11],
    [-0.32, -0.11]
  ]);

/** Red wax seal with two ribbon tails, pressed with an enamel ring. */
const addSeal = (page: Group) => {
  for (const side of [-1, 1])
    put(
      page,
      new BoxGeometry(0.07, 0.22, 0.012),
      surfaces.enamel,
      [-0.14 + side * 0.05, -0.37, 0.025],
      [0, 0, side * 0.3]
    );
  put(
    page,
    new CylinderGeometry(0.12, 0.125, 0.04, 28),
    surfaces.wax,
    [-0.14, -0.26, 0.04],
    [Math.PI / 2, 0, 0]
  );
  put(page, new TorusGeometry(0.08, 0.014, 8, 24), surfaces.gold, [-0.14, -0.26, 0.065]);
};

/** Bold gold arrow on a dark bronze backing, so its outline holds on light and dark paper. */
const addArrow = (root: Group, direction: "in" | "out") => {
  const arrow = group(
    root,
    [direction === "out" ? 0.24 : -0.26, -0.06, 0.15],
    [0, 0, direction === "out" ? 0.35 : -0.35]
  );
  put(arrow, slab(arrowShape(), 0.1, 0.025), [surfaces.gold, surfaces.brass]);
  put(arrow, slab(arrowShape(), 0.06, 0.02), surfaces.darkWood, [0.005, -0.004, -0.05]).scale.set(
    1.14,
    1.22,
    1
  );
  arrow.scale.setScalar(1.2);
};

/** Export / import: a parchment page with a wax seal and a gold arrow leaving it or entering it. */
export const createDocumentArrow = (direction: "in" | "out") => {
  const root = new Group();
  const page = group(
    root,
    [direction === "out" ? -0.18 : 0.18, 0, 0],
    [0, direction === "out" ? 0.2 : -0.2, 0]
  );
  const edge = new MeshStandardMaterial({ color: "#6e4420", roughness: 0.9 });
  put(page, new BoxGeometry(0.56, 0.74, 0.04), [
    edge,
    edge,
    edge,
    edge,
    paintedMaterial(96, 128, paintLetter),
    edge
  ]);
  addSeal(page);
  addArrow(root, direction);
  return root;
};
