import {
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  PlaneGeometry,
  Shape,
  TorusGeometry,
  Vector2
} from "three";

import { group, type Paint, paintedMaterial, put, slab, surfaces } from "./ui-action-icon-kit";

/** Credits: an unrolled papyrus scroll on turned wooden rods, inked lines and a red wax seal. */
const SHEET_WIDTH = 0.86;
const SHEET_HEIGHT = 1.02;
const ROLL_RADIUS = 0.085;
const ROD_RADIUS = 0.03;
const ROD_LENGTH = SHEET_WIDTH + 0.2;

/** Deterministic pseudo random sequence, so every export renders the same stains and fibres. */
const seededRandom = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

/** Aged papyrus: fibre streaks, soft stains and darker, browned edges. */
const paintPapyrusBase = (context: CanvasRenderingContext2D, width: number, height: number) => {
  const random = seededRandom(41);
  context.fillStyle = "#d8b97c";
  context.fillRect(0, 0, width, height);
  context.globalAlpha = 0.26;
  for (let fibre = 0; fibre < 260; fibre++) {
    context.fillStyle = fibre % 2 ? "#a47c42" : "#ecd8a4";
    context.fillRect(random() * width, random() * height, 20 + random() * 60, 1);
  }
  for (let stain = 0; stain < 9; stain++) {
    const x = random() * width, y = random() * height, radius = 12 + random() * 30;
    const blot = context.createRadialGradient(x, y, 0, x, y, radius);
    blot.addColorStop(0, "#9c7440");
    blot.addColorStop(1, "#9c744000");
    context.fillStyle = blot;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.globalAlpha = 1;
  const edge = context.createLinearGradient(0, 0, width, 0);
  edge.addColorStop(0, "#7a4f22aa");
  edge.addColorStop(0.1, "#7a4f2200");
  edge.addColorStop(0.9, "#7a4f2200");
  edge.addColorStop(1, "#7a4f22aa");
  context.fillStyle = edge;
  context.fillRect(0, 0, width, height);
};

/** Inked text rows of words, a centred heading and a red initial at the first paragraph. */
const paintScript = (context: CanvasRenderingContext2D, width: number, height: number) => {
  const random = seededRandom(7);
  context.fillStyle = "#4a2c17";
  context.fillRect(width * 0.28, 22, width * 0.44, 7);
  context.fillRect(width * 0.36, 36, width * 0.28, 4);
  context.fillStyle = "#a3241e";
  context.fillRect(26, 58, 24, 26);
  context.fillStyle = "#4a2c17";
  for (let row = 0, y = 60; y < height - 70; row++, y += 15) {
    let x = row < 2 ? 58 : 26;
    const end = row % 6 === 5 ? width * 0.55 : width - 26;
    while (x < end) {
      const length = 8 + random() * 26;
      context.fillRect(x, y, Math.min(length, end - x), 3);
      x += length + 5;
    }
  }
};

const paintSheet: Paint = (context, width, height) => {
  paintPapyrusBase(context, width, height);
  paintScript(context, width, height);
};

/** End of a roll: the papyrus layers wound in a spiral around the rod. */
const paintRollEnd: Paint = (context, width, height) => {
  const middle = width / 2;
  context.fillStyle = "#dcc28a";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#8a6232";
  context.lineWidth = 2;
  context.beginPath();
  for (let step = 0; step < 360; step++) {
    const angle = step * 0.11, radius = 12 + step * 0.14;
    context.lineTo(middle + Math.cos(angle) * radius, middle + Math.sin(angle) * radius);
  }
  context.stroke();
};

/** The visible sheet, gently waved so the light catches its surface. */
const createSheet = () => {
  const sheet = new PlaneGeometry(SHEET_WIDTH, SHEET_HEIGHT, 24, 32);
  const position = sheet.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index), y = position.getY(index);
    position.setZ(index, 0.018 * Math.sin(y * 7) + 0.012 * Math.sin(x * 6 + 1));
  }
  sheet.computeVertexNormals();
  const material = paintedMaterial(256, 320, paintSheet, 0.85);
  material.side = DoubleSide;
  return { material, sheet };
};

/** A turned wooden knob with a brass collar, pointing outwards along the rod. */
const addFinial = (roll: Group, side: number) => {
  const profile = [[0, 0], [0.04, 0], [0.05, 0.03], [0.038, 0.06], [0.055, 0.1], [0.03, 0.14], [0, 0.15]]
    .map(([radius, height]) => new Vector2(radius, height));
  const knob = put(roll, new LatheGeometry(profile, 24), surfaces.darkWood,
    [side * ROD_LENGTH / 2, 0, 0], [0, 0, -side * Math.PI / 2]);
  knob.scale.setScalar(0.9);
  put(roll, new TorusGeometry(0.036, 0.009, 8, 24), surfaces.brass,
    [side * (ROD_LENGTH / 2 - 0.004), 0, 0], [0, Math.PI / 2, 0]);
};

/** A wound papyrus roll on its rod: parchment drum, spiral ends, rod and knobs. */
const addRoll = (scroll: Group, y: number) => {
  const roll = group(scroll, [0, y, -ROLL_RADIUS + 0.01]);
  const drum = paintedMaterial(64, 64, paintPapyrusBase, 0.85);
  put(roll, new CylinderGeometry(ROLL_RADIUS, ROLL_RADIUS, SHEET_WIDTH, 40, 1, true), drum,
    [0, 0, 0], [0, 0, Math.PI / 2]);
  const end = paintedMaterial(64, 64, paintRollEnd, 0.9);
  for (const side of [-1, 1]) {
    put(roll, new CircleGeometry(ROLL_RADIUS, 40), end, [side * SHEET_WIDTH / 2, 0, 0],
      [0, side * Math.PI / 2, 0]);
    addFinial(roll, side);
  }
  put(roll, new CylinderGeometry(ROD_RADIUS, ROD_RADIUS, ROD_LENGTH, 20), surfaces.wood,
    [0, 0, 0], [0, 0, Math.PI / 2]);
};

/** A scalloped wax disc pressed onto the sheet, with an embossed ring and two ribbon tails. */
const addSeal = (scroll: Group) => {
  const seal = group(scroll, [0.22, -0.3, 0.04]);
  for (const side of [-1, 1]) {
    const tail = new Shape();
    tail.moveTo(-0.03, 0);
    tail.lineTo(0.03, 0);
    tail.lineTo(0.035, -0.22);
    tail.lineTo(0, -0.18);
    tail.lineTo(-0.035, -0.22);
    tail.closePath();
    put(seal, slab(tail, 0.006, 0.002), surfaces.gold, [side * 0.035, -0.02, -0.012], [0, 0, side * 0.32]);
  }
  const blob = new Shape();
  for (let point = 0; point <= 48; point++) {
    const angle = (point / 48) * Math.PI * 2, radius = 0.1 + 0.008 * Math.sin(point * 1.5);
    blob[point ? "lineTo" : "moveTo"](Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  put(seal, slab(blob, 0.025, 0.012), surfaces.wax);
  put(seal, new TorusGeometry(0.062, 0.008, 10, 36), surfaces.wax, [0, 0, 0.02]);
  put(seal, new CylinderGeometry(0.026, 0.03, 0.012, 20), surfaces.wax, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
};

export const createCreditsScroll = () => {
  const root = new Group();
  const scroll = group(root, [0, 0, 0], [-0.12, -0.36, 0.1]);
  const { material, sheet } = createSheet();
  put(scroll, sheet, material);
  for (const side of [-1, 1]) addRoll(scroll, side * SHEET_HEIGHT / 2);
  addSeal(scroll);
  return root;
};
