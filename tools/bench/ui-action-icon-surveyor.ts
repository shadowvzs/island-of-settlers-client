import {
  BoxGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Group,
  MeshPhysicalMaterial,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector3
} from "three";

import { group, type Paint, paintedMaterial, put, slab, surfaces } from "./ui-action-icon-kit";

/** Map editor icon: a surveyor's chart on a walnut writing board, an ink pot and a dipped quill. */

const inkLines = (context: CanvasRenderingContext2D, width: number, height: number) => {
  context.strokeStyle = "#2f4f5c";
  context.globalAlpha = 0.45;
  context.lineWidth = 1.5;
  for (let line = 1; line < 8; line++) {
    context.beginPath();
    context.moveTo((line * width) / 8, 0);
    context.lineTo((line * width) / 8, height);
    context.moveTo(0, (line * height) / 8);
    context.lineTo(width, (line * height) / 8);
    context.stroke();
  }
  context.globalAlpha = 1;
};

const coastline = (context: CanvasRenderingContext2D, width: number, height: number) => {
  context.beginPath();
  context.moveTo(width * 0.18, height * 0.52);
  context.bezierCurveTo(
    width * 0.14,
    height * 0.2,
    width * 0.5,
    height * 0.1,
    width * 0.64,
    height * 0.3
  );
  context.bezierCurveTo(
    width * 0.84,
    height * 0.4,
    width * 0.8,
    height * 0.78,
    width * 0.52,
    height * 0.82
  );
  context.bezierCurveTo(
    width * 0.3,
    height * 0.88,
    width * 0.22,
    height * 0.72,
    width * 0.18,
    height * 0.52
  );
};

const paintSurvey: Paint = (context, width, height) => {
  context.fillStyle = "#e9d29a";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#4f93b0";
  context.fillRect(width * 0.05, height * 0.07, width * 0.9, height * 0.86);
  coastline(context, width, height);
  context.fillStyle = "#e6cd8c";
  context.fill();
  context.fillStyle = "#5f9a3c";
  context.beginPath();
  context.ellipse(width * 0.46, height * 0.5, width * 0.17, height * 0.2, 0.4, 0, Math.PI * 2);
  context.fill();
  inkLines(context, width, height);
  coastline(context, width, height);
  context.strokeStyle = "#2b1d10";
  context.lineWidth = 4;
  context.stroke();
  context.strokeStyle = "#b0261c";
  context.lineWidth = 5;
  context.setLineDash([9, 7]);
  context.beginPath();
  context.moveTo(width * 0.28, height * 0.72);
  context.quadraticCurveTo(width * 0.42, height * 0.4, width * 0.62, height * 0.44);
  context.stroke();
  context.setLineDash([]);
};

/** Goose feather barbs: cream at the root darkening to a grey-brown tip, shaft down the middle. */
const paintVane: Paint = (context, width, height) => {
  const shade = context.createLinearGradient(0, height, 0, 0);
  shade.addColorStop(0, "#f2eadb");
  shade.addColorStop(0.55, "#b9a68a");
  shade.addColorStop(1, "#4c3a2a");
  context.fillStyle = shade;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#00000033";
  context.lineWidth = 1;
  for (let y = 0; y < height + width; y += 5) {
    context.beginPath();
    context.moveTo(width / 2, y);
    context.lineTo(0, y - width * 0.6);
    context.moveTo(width / 2, y);
    context.lineTo(width, y - width * 0.6);
    context.stroke();
  }
};

/** Vane outline in shape units: x from -0.1 to 0.15, y from 0 to 1. */
const featherShape = () => {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.16, 0.28, 0.14, 0.7);
  shape.quadraticCurveTo(0.09, 0.92, 0, 1);
  shape.quadraticCurveTo(-0.1, 0.66, -0.08, 0.32);
  shape.quadraticCurveTo(-0.05, 0.12, 0, 0);
  return shape;
};

const addQuill = (parent: Group, position: readonly number[], rotation: readonly number[]) => {
  const quill = group(parent, position, rotation);
  const vane = paintedMaterial(64, 256, paintVane, 0.8);
  // Extruded shapes take their raw x / y as UVs: map the vane outline onto the whole texture.
  vane.map!.repeat.set(1 / 0.26, 1);
  vane.map!.offset.set(0.1 / 0.26, 0);
  put(quill, slab(featherShape(), 0.014, 0.006), vane, [0, 0.2, 0]);
  const shaft = new CatmullRomCurve3([
    new Vector3(0, -0.1, 0),
    new Vector3(0, 0.5, 0.014),
    new Vector3(-0.004, 1.2, 0.012)
  ]);
  put(quill, new TubeGeometry(shaft, 24, 0.018, 8), surfaces.paper);
  put(quill, new ConeGeometry(0.02, 0.12, 10), surfaces.gold, [0, -0.16, 0], [Math.PI, 0, 0]);
};

const addInkPot = (parent: Group, position: readonly number[]) => {
  const pot = group(parent, position);
  const glass = new MeshPhysicalMaterial({
    clearcoat: 1,
    color: "#1a1d2b",
    metalness: 0.1,
    roughness: 0.15
  });
  put(pot, new CylinderGeometry(0.16, 0.19, 0.22, 32), glass, [0, 0.11, 0]);
  put(pot, new CylinderGeometry(0.08, 0.1, 0.07, 24), surfaces.brass, [0, 0.25, 0]);
  put(
    pot,
    new TorusGeometry(0.085, 0.018, 8, 24),
    surfaces.brass,
    [0, 0.29, 0],
    [Math.PI / 2, 0, 0]
  );
};

/** Map editor: a chart on a walnut writing board, an ink pot behind it and a quill dipped in it. */
export const createMapEditorIcon = () => {
  const root = new Group();
  const desk = group(root, [0, 0, 0], [0, 0.56, 0]);
  put(desk, new BoxGeometry(1.42, 0.06, 1.08), surfaces.darkWood, [0, -0.03, 0]);
  const chart = paintedMaterial(256, 192, paintSurvey);
  put(desk, new BoxGeometry(1.26, 0.012, 0.92), [
    surfaces.paper,
    surfaces.paper,
    chart,
    surfaces.paper,
    surfaces.paper,
    surfaces.paper
  ]);
  addInkPot(desk, [0.5, 0, -0.42]);
  addQuill(desk, [0.5, 0.24, -0.42], [-0.2, 0, 0.5]);
  return root;
};
