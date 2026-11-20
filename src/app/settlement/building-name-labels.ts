import type { TerrainRenderer } from "../../render-common/renderer-contract";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { createOverlayCanvas, fitCanvasToViewport } from "../helpers";
import { matchesHotkey } from "../settings/hotkeys/bindings";

interface BuildingNameLabelsOptions {
  buildingName: (typeId: number) => string;
  buildings: () => readonly SettlementBuilding[];
  isVisible: (building: SettlementBuilding) => boolean;
  renderer: Pick<TerrainRenderer, "projectToViewport">;
  viewport: HTMLElement;
}

/** The saved binding toggles localized names. Hidden labels have no per-frame projection or layout cost. */
export const createBuildingNameLabels = (options: BuildingNameLabelsOptions) => {
  const { renderer, viewport } = options;
  const canvas = createOverlayCanvas(viewport, "settlement-building-names");
  canvas.hidden = true;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { height: "100%", inset: "0", pointerEvents: "none",
    position: "absolute", width: "100%", zIndex: "2" });
  const context = canvas.getContext("2d")!;
  const widths = new Map<string, number>();
  const onKeyDown = (event: KeyboardEvent) => {
    if (!matchesHotkey("buildingNames", event)) return;
    event.preventDefault();
    canvas.hidden = !canvas.hidden;
  };
  window.addEventListener("keydown", onKeyDown);
  const update = () => {
    if (canvas.hidden) return;
    const ratio = fitCanvasToViewport(canvas, viewport);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const width = canvas.width / ratio, height = canvas.height / ratio;
    context.clearRect(0, 0, width, height);
    context.font = "600 12px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const occupied: { left: number; top: number; right: number; bottom: number }[] = [];
    for (const building of options.buildings()) {
      if (!options.isVisible(building)) continue;
      const point = renderer.projectToViewport(building.x, building.y + 3, building.z);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const name = options.buildingName(building.typeId);
      let labelWidth = widths.get(name);
      if (labelWidth === undefined) { labelWidth = context.measureText(name).width + 12; widths.set(name, labelWidth); }
      const box = { bottom: point.y + 10, left: point.x - labelWidth / 2,
        right: point.x + labelWidth / 2, top: point.y - 10 };
      if (box.right < 0 || box.left > width || box.bottom < 0 || box.top > height) continue;
      if (occupied.some(other => box.left < other.right && box.right > other.left &&
        box.top < other.bottom && box.bottom > other.top)) continue;
      occupied.push(box);
      context.lineJoin = "round";
      context.lineWidth = 3;
      context.strokeStyle = "#271e18";
      context.strokeText(name, point.x, point.y);
      context.fillStyle = "#fff2cf";
      context.fillText(name, point.x, point.y);
    }
  };
  return { dispose: () => { window.removeEventListener("keydown", onKeyDown); canvas.remove(); }, update };
};
