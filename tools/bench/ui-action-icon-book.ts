import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  type Material,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Shape
} from "three";

import { group, type Paint, paintedMaterial, polygon, put, slab, surfaces } from "./ui-action-icon-kit";

/** Register: a leather-bound ledger opened flat at the middle, both written pages spread wide. */
const PAGE_WIDTH = 0.66;
const PAGE_HEIGHT = 0.88;
/** Height of the page stack at the fore-edge above the cover board. */
const STACK = 0.075;
const COVER_MARGIN = 0.035;
const BOARD = 0.03;
const COLUMNS = 40;
const ROWS = 14;

type Side = "left" | "right";
type Point = readonly [number, number, number];

const smooth = (value: number) => {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
};

/** Leaves rise steeply out of the gutter and settle flat; the right page's top corner curls up. */
const pageLift = (side: Side, across: number, along: number) => {
  const rise = STACK * (1 - (1 - across) ** 3) + 0.035 * Math.sin(Math.PI * across);
  if (side === "left") return rise;
  return rise + 0.11 * smooth((across - 0.72) / 0.28) ** 2 * smooth((along - 0.5) / 0.5);
};

/** World point of a page at `across` (0 gutter .. 1 fore-edge) and `along` (0 tail .. 1 head). */
const pagePoint = (side: Side, across: number, along: number): Point => [
  (side === "right" ? 1 : -1) * across * PAGE_WIDTH,
  (along - 0.5) * PAGE_HEIGHT,
  pageLift(side, across, along)
];

export const paintLeather: Paint = (context, width, height) => {
  context.fillStyle = "#5e1c10";
  context.fillRect(0, 0, width, height);
  context.globalAlpha = 0.35;
  for (let grain = 0; grain < 2600; grain++) {
    context.fillStyle = grain % 3 ? "#4a150b" : "#86321e";
    context.fillRect((grain * 47.3) % width, (grain * 83.9) % height, 2 + (grain % 3), 1 + (grain % 2));
  }
  context.globalAlpha = 1;
};

/** Stacked leaves seen edge-on: fine lines running along the edge. */
export const paintLeaves: Paint = (context, width, height) => {
  context.fillStyle = "#e4cf9f";
  context.fillRect(0, 0, width, height);
  for (let leaf = 0; leaf < height; leaf += 4) {
    context.fillStyle = leaf % 8 ? "#c9ad78" : "#a98b58";
    context.fillRect(0, leaf, width, 2);
  }
};

/** Ink handwriting: rows of word strokes of varying length, a short line closing each paragraph. */
const writeLines = (context: CanvasRenderingContext2D, area: readonly number[], seed: number) => {
  const [left, top, right, bottom] = area as [number, number, number, number];
  context.fillStyle = "#4a3320";
  for (let row = 0, y = top; y < bottom; row++, y += 17) {
    let x = left + (row % 5 === 0 ? 14 : 0);
    const end = row % 5 === 4 ? left + (right - left) * 0.55 : right;
    for (let word = 0; x < end; word++) {
      const length = 10 + ((seed + row * 7 + word * 13) % 5) * 7;
      context.fillRect(x, y, Math.min(length, end - x), 3);
      x += length + 6;
    }
  }
};

/** Sepia sketch of a merchant ship in a ruled frame: the page's illustration. */
const drawShipSketch = (context: CanvasRenderingContext2D, x: number, y: number, size: number) => {
  context.strokeStyle = "#6b4a2a";
  context.lineWidth = 3;
  context.strokeRect(x, y, size * 1.4, size);
  context.fillStyle = "#d8c08c";
  context.fillRect(x + 4, y + size * 0.72, size * 1.4 - 8, size * 0.24);
  context.beginPath();
  context.moveTo(x + size * 0.2, y + size * 0.66);
  context.quadraticCurveTo(x + size * 0.7, y + size * 0.92, x + size * 1.2, y + size * 0.66);
  context.closePath();
  context.fillStyle = "#7a5230";
  context.fill();
  context.fillRect(x + size * 0.68, y + size * 0.12, 4, size * 0.56);
  context.beginPath();
  context.moveTo(x + size * 0.72, y + size * 0.16);
  context.quadraticCurveTo(x + size * 1.08, y + size * 0.36, x + size * 0.72, y + size * 0.6);
  context.closePath();
  context.fillStyle = "#efe2c0";
  context.fill();
  context.stroke();
};

/** Darkens the page towards the gutter where the paper bends into the binding. */
const shadeGutter = (context: CanvasRenderingContext2D, width: number, height: number, side: Side) => {
  const gutter = side === "right" ? 0 : width;
  const shade = context.createLinearGradient(gutter, 0, side === "right" ? width * 0.3 : width * 0.7, 0);
  shade.addColorStop(0, "#5a3c1a88");
  shade.addColorStop(1, "#0000");
  context.fillStyle = shade;
  context.fillRect(0, 0, width, height);
};

/** Left: a red initial, margin rule and ledger entries. Right: a ship sketch above the text. */
const paintPage = (side: Side): Paint => (context, width, height) => {
  context.fillStyle = "#ecdcb0";
  context.fillRect(0, 0, width, height);
  const left = side === "right" ? 40 : 24, right = width - (side === "right" ? 24 : 40);
  if (side === "left") {
    context.fillStyle = "#a3241e";
    context.fillRect(left, 26, 30, 36);
    context.fillRect(left + 40, 70, 2, height - 100);
    writeLines(context, [left + 40, 36, right, 66], 3);
    writeLines(context, [left + 50, 84, right, height - 30], 5);
  } else {
    drawShipSketch(context, left + 18, 30, 120);
    writeLines(context, [left, 176, right, height - 30], 11);
  }
  shadeGutter(context, width, height, side);
};

/** A curved page surface on a segmented plane, mapped with its painted writing. */
const pageSurface = (side: Side) => {
  const geometry = new PlaneGeometry(PAGE_WIDTH, PAGE_HEIGHT, COLUMNS, ROWS);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < position.count; index++) {
    const u = uv.getX(index);
    const point = pagePoint(side, side === "right" ? u : 1 - u, uv.getY(index));
    position.setXYZ(index, point[0], point[1], point[2]);
  }
  geometry.computeVertexNormals();
  return geometry;
};

/** A strip from the cover board up to a page edge, so the stack of leaves shows its thickness. */
const edgeStrip = (points: readonly Point[]) => {
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
  points.forEach(([x, y, z], index) => {
    const u = index / (points.length - 1);
    vertices.push(x, y, 0, x, y, z);
    uvs.push(u, 0, u, 1);
    if (!index) return;
    const base = index * 2;
    indices.push(base - 2, base, base - 1, base - 1, base, base + 1);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const sample = (count: number, point: (step: number) => Point) =>
  Array.from({ length: count + 1 }, (_, step) => point(step / count));

const addPageSide = (book: Group, side: Side, leaves: Material) => {
  put(book, pageSurface(side), paintedMaterial(256, 340, paintPage(side), 0.85));
  for (const along of [0, 1])
    put(book, edgeStrip(sample(COLUMNS, across => pagePoint(side, across, along))), leaves);
  put(book, edgeStrip(sample(ROWS, along => pagePoint(side, 1, along))), leaves);
};

export const roundedRect = (width: number, height: number, radius: number) => {
  const shape = new Shape();
  const x = -width / 2, y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
};

/** Brass corner guards on the outer corners of one cover board. */
const addCornerGuards = (board: Group, direction: number) => {
  const guard = polygon([[0, 0], [0.12, 0], [0, 0.12]]);
  const outer = direction * (PAGE_WIDTH / 2 + COVER_MARGIN + 0.004);
  for (const vertical of [-1, 1]) {
    // The guard's right angle sits on the corner, its legs running back along both edges.
    const turn = Math.atan2(-vertical, -direction) - Math.PI / 4;
    put(board, slab(guard, 0.01, 0.005), [surfaces.brass, surfaces.bronze],
      [outer, vertical * (PAGE_HEIGHT / 2 + COVER_MARGIN + 0.004), BOARD / 2], [0, 0, turn]);
  }
};

/** Leather boards under both pages and the rounded spine between them. */
const addCover = (book: Group) => {
  const leather = paintedMaterial(256, 256, paintLeather, 0.55);
  leather.map!.wrapS = leather.map!.wrapT = RepeatWrapping;
  const boardShape = roundedRect(PAGE_WIDTH + COVER_MARGIN * 2, PAGE_HEIGHT + COVER_MARGIN * 2, 0.03);
  for (const direction of [-1, 1]) {
    const board = group(book, [direction * (PAGE_WIDTH / 2 + 0.01), 0, -BOARD / 2], [0, direction * 0.05, 0]);
    put(board, slab(boardShape, BOARD * 0.6, BOARD * 0.2), leather);
    addCornerGuards(board, direction);
  }
  const spine = put(book, new CylinderGeometry(0.06, 0.06, PAGE_HEIGHT + COVER_MARGIN * 2, 24), leather,
    [0, 0, -BOARD * 0.9]);
  spine.scale.set(1, 1, 0.55);
};

/** Red and gold silk headbands at both ends of the spine. */
const addHeadbands = (book: Group) => {
  const silk = paintedMaterial(32, 8, (context, width, height) => {
    for (let stripe = 0; stripe < width; stripe += 4) {
      context.fillStyle = stripe % 8 ? "#d8a640" : "#9b1b1b";
      context.fillRect(stripe, 0, 4, height);
    }
  }, 0.45);
  for (const vertical of [-1, 1])
    put(book, new CylinderGeometry(0.018, 0.018, 0.08, 12), silk,
      [0, vertical * (PAGE_HEIGHT / 2 - 0.005), 0.012], [0, 0, Math.PI / 2]);
};

/** Ribbon bookmark lying in the gutter and falling over the tail of the book. */
const addRibbon = (book: Group) => {
  const silk = new MeshStandardMaterial({ color: "#b3122a", roughness: 0.4, side: DoubleSide });
  put(book, new PlaneGeometry(0.04, PAGE_HEIGHT * 0.55), silk, [0.03, -PAGE_HEIGHT * 0.2, 0.026],
    [0, 0.35, 0]);
  const fall = group(book, [0.03, -PAGE_HEIGHT / 2 - 0.005, 0.02], [-1.1, 0, 0.1]);
  put(fall, new PlaneGeometry(0.04, 0.16), silk, [0, -0.08, 0]);
  const tail = polygon([[-0.02, 0], [0.02, 0], [0.02, -0.06], [0, -0.035], [-0.02, -0.06]]);
  put(fall, slab(tail, 0.003, 0.001), silk, [0, -0.16, 0]);
};

export const createRegisterBook = () => {
  const root = new Group();
  const book = group(root, [0, 0, 0], [-0.72, 0.12, 0.3]);
  const leaves = paintedMaterial(64, 64, paintLeaves, 0.9);
  leaves.side = DoubleSide;
  addCover(book);
  addPageSide(book, "left", leaves);
  addPageSide(book, "right", leaves);
  addHeadbands(book);
  addRibbon(book);
  return root;
};
