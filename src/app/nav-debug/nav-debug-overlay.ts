import type { CameraState } from "../../render-common/camera-state";
import { PIXELS_PER_UNIT } from "../../render-common/iso-projection";
import type { AnimalManager } from "../../render-common/wildlife/animal-manager";
import {
  type DebugArea,
  drawAnimals,
  drawColliders,
  drawWalkMask,
  type Project
} from "./nav-debug-draw";

/** The mask is only drawn this close (it is one quad per nav cell). */
const MASK_MIN_ZOOM = 0.7;

const getArea = (camera: CameraState): DebugArea => {
  const reach =
    Math.max(camera.viewportWidth, camera.viewportHeight) / (PIXELS_PER_UNIT * camera.zoom);
  return {
    maxX: camera.centerX + reach,
    maxZ: camera.centerZ + reach,
    minX: camera.centerX - reach,
    minZ: camera.centerZ - reach
  };
};

const getLegend = (manager: AnimalManager) =>
  `regions ${manager.countHomeRegions()} (${manager.countSimulatedRegions()} awake)  ` +
  `animals ${manager.countAlive()}  drawn ${manager.countDrawn()}` +
  "  |  green all  yellow rabbit only  orange steep  red rock / cliff  blue water";

/**
 * Navigation debug view (?navdebug=1): walkable mask, trunk / rock / shrub colliders, every
 * living animal's clearance, route, target, velocity, state and threat. Projects with the
 * renderer's last camera, so it lines up in every view mode.
 */
export const createNavDebugOverlay = (
  viewport: HTMLElement,
  manager: AnimalManager,
  camera: CameraState,
  project: Project
) => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  viewport.append(canvas);
  const context = canvas.getContext("2d")!;
  const { nav } = manager.debug;
  let disposed = false;
  let frameHandle = 0;

  const draw = () => {
    if (disposed) return;
    const { viewportHeight, viewportWidth } = camera;
    if (canvas.width !== viewportWidth || canvas.height !== viewportHeight) {
      canvas.width = viewportWidth;
      canvas.height = viewportHeight;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    const area = getArea(camera);
    if (camera.zoom >= MASK_MIN_ZOOM) drawWalkMask(context, nav, project, area);
    drawColliders(context, nav, project, area);
    drawAnimals(context, manager, project);
    context.fillStyle = "rgba(0, 0, 0, 0.6)";
    context.fillRect(8, viewportHeight - 28, viewportWidth - 16, 20);
    context.fillStyle = "#ffffff";
    context.fillText(getLegend(manager), 14, viewportHeight - 14);
    frameHandle = requestAnimationFrame(draw);
  };
  frameHandle = requestAnimationFrame(draw);
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameHandle);
      canvas.remove();
    }
  };
};
