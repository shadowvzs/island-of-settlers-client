import { MATERIAL } from "../shared/world/world-data";
import { createIconCanvas, fillWithTile, OUTLINE, SIZE, toPath } from "./relief-icons";

/** Which way the arrow points: back (undo) or forward again (redo, mirrored). */
export type HistoryMark = "redo" | "undo";

const CENTRE = SIZE / 2;
const DISC_RADIUS = 216;
const GLYPH = "rgb(250 250 246)";
/** The hook's turn: centre and radius (the arrow runs left along its top). */
const TURN = { radius: 82, x: 300, y: 292 };
const HEAD: readonly (readonly [number, number])[] = [
  [104, 210],
  [190, 140],
  [190, 280]
];

/** The hooked arrow: from the lower left round the turn, pointing left along the top. */
const drawHook = (context: CanvasRenderingContext2D, color: string, width: number) => {
  const hook = new Path2D();
  hook.moveTo(180, TURN.y + TURN.radius);
  hook.lineTo(TURN.x, TURN.y + TURN.radius);
  hook.arc(TURN.x, TURN.y, TURN.radius, Math.PI / 2, -Math.PI / 2, true);
  hook.lineTo(170, TURN.y - TURN.radius);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.stroke(hook);
  const head = toPath(HEAD);
  context.lineWidth = width - 36;
  context.fill(head);
  context.stroke(head);
};

/**
 * Undo / redo (original glyph): a round slate of the terrain's rock tile with a light hooked
 * arrow pointing back, mirrored for redo.
 */
export const renderHistoryIcon = (mark: HistoryMark) => {
  const { canvas, context } = createIconCanvas();
  const disc = new Path2D();
  disc.arc(CENTRE, CENTRE, DISC_RADIUS, 0, Math.PI * 2);
  fillWithTile(context, MATERIAL.rock, disc);
  context.fillStyle = "rgb(40 92 150 / 55%)";
  context.fill(disc);
  context.lineWidth = 10;
  context.strokeStyle = OUTLINE;
  context.stroke(disc);
  if (mark === "redo") {
    context.translate(SIZE, 0);
    context.scale(-1, 1);
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  drawHook(context, OUTLINE, 64);
  drawHook(context, GLYPH, 40);
  return canvas;
};
