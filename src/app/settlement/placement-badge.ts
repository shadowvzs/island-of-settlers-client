interface Point { x: number; z: number }
interface ScreenPoint { x: number; y: number }

/** Legible pointer status shared by building, road, survey and free-decoration placement. */
export const createPlacementBadge = (context: CanvasRenderingContext2D, viewport: HTMLElement,
  project: (point: Point) => ScreenPoint) => (point: Point, text: string, refused = false) => {
  const screen = project(point);
  context.font = "600 12px system-ui"; context.lineWidth = 4;
  const width = context.measureText(text).width;
  const x = screen.x + 16 + width > viewport.clientWidth - 8 ? Math.max(4, screen.x - 16 - width) : screen.x + 16;
  context.strokeStyle = "#18221be6"; context.strokeText(text, x, screen.y - 14);
  context.fillStyle = refused ? "#ffaaa0" : "#ffe4b3";
  context.fillText(text, x, screen.y - 14);
  return { x, y: screen.y };
};
