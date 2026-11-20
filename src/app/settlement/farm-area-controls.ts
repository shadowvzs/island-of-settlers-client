import type { TerrainRenderer } from "../../render-common/renderer-contract";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { buildingAreaRange } from "../../shared/settlement/settlement-work-ranges";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { createOverlayCanvas, fitCanvasToViewport } from "../helpers";

/** Dashed work range for the currently focused resource building. */
export const createFarmAreaControls = (options: {
  simulation: SettlementSimulation; world: WorldData;
  renderer: Pick<TerrainRenderer, "projectToViewport">;
  canvas: HTMLCanvasElement; viewport?: HTMLElement;
  focusedBuilding(): number | null;
}) => {
  const { canvas, renderer, simulation, world } = options;
  const viewport = options.viewport ?? canvas.parentElement ?? document.body;
  const overlay = createOverlayCanvas(viewport, "settlement-farm-area");
  Object.assign(overlay.style, { position: "absolute", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", zIndex: "2" });
  const context = overlay.getContext("2d")!;
  const updatePreview = () => {
    const ratio = fitCanvasToViewport(overlay, viewport);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, overlay.width, overlay.height);
    const uid = options.focusedBuilding();
    if (uid === null) return;
    const entry = simulation.buildings().find(building => building.uid === uid);
    if (!entry) return;
    const area = buildingAreaRange(entry, simulation.playerNation());
    if (!area) return;
    const { center: origin, radius } = area;
    const points = Array.from({ length: 48 }, (_, index) => {
        const angle = index * Math.PI * 2 / 48;
        return { x: Math.max(0, Math.min(world.cellsX, origin.x + Math.cos(angle) * radius)),
          z: Math.max(0, Math.min(world.cellsZ, origin.z + Math.sin(angle) * radius)) };
      });
    context.beginPath();
    points.forEach((point, index) => {
      const screen = renderer.projectToViewport(point.x, sampleSmooth(world, world.heights, point.x, point.z) + 0.06, point.z);
      if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
    });
    context.closePath(); context.fillStyle = "#e6c87516"; context.fill();
    context.strokeStyle = "#eed993"; context.lineWidth = 2; context.setLineDash([7, 4]); context.stroke(); context.setLineDash([]);
  };
  return { updatePreview, dispose: () => overlay.remove() };
};
