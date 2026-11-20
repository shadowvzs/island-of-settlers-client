import { type Camera, Raycaster, Vector2, Vector3 } from "three";

import { type PickGround, pickGroundAlongRay } from "../../render-common/ground-pick";
import type { ArmyTargetHoverOutline, FrameState } from "../../render-common/renderer-contract";
import { HOVER_POINTER_CURSOR } from "../../render-common/ui-cursor";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import type { createThreeBuildings } from "./buildings/three-buildings";
import { createDepositSignTooltip } from "./settlement/deposit-sign-tooltip";
import type { createShipInteraction } from "./settlement/ship-interaction";
import type { createThreeBridges } from "./settlement/three-bridges";
import type { createThreeDepositSigns } from "./settlement/three-deposit-signs";

const projected = new Vector3();
/** CSS pixels: same reach as the army click selection (`SOLDIER_PICK_RADIUS`). */
const SOLDIER_HOVER_RADIUS = 22;

/** CSS pixel position of a world point with the camera of the last frame (raycast style picking). */
const projectWithCamera = (
  camera: Camera | null,
  state: FrameState["camera"] | null,
  x: number,
  y: number,
  z: number
) => {
  if (!camera || !state) return { depth: 0, x: Number.NaN, y: Number.NaN };
  projected.set(x, y, z).project(camera);
  return {
    depth: projected.z,
    x: ((projected.x + 1) / 2) * state.viewportWidth,
    y: ((1 - projected.y) / 2) * state.viewportHeight
  };
};

const pickRaycaster = new Raycaster();
const pickPointer = new Vector2();

/**
 * Ground under a CSS pixel: the last frame's camera ray (the same camera as projectToViewport),
 * marched over the shared heights the terrain mesh is built from.
 */
const pickWithCamera = (
  world: PickGround,
  camera: Camera | null,
  state: FrameState["camera"] | null,
  x: number,
  y: number,
  bridgeHeight?: (x: number, z: number) => number | undefined
) => {
  if (!camera || !state) return null;
  pickPointer.set((x / state.viewportWidth) * 2 - 1, 1 - (y / state.viewportHeight) * 2);
  pickRaycaster.setFromCamera(pickPointer, camera);
  const ground = pickGroundAlongRay(world, pickRaycaster.ray);
  if (!ground || !bridgeHeight) return ground;
  const { direction, origin } = pickRaycaster.ray;
  if (Math.abs(direction.y) < 1e-9) return ground;
  let point = ground;
  // The deck can stand above the terrain picked behind it: converge on the plane the ray meets first.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const deck = bridgeHeight(point.x, point.z);
    if (deck === undefined || deck <= ground.y + 0.01) return ground;
    const distance = (deck - origin.y) / direction.y;
    if (distance < 0) return ground;
    const next = { x: origin.x + direction.x * distance, y: deck, z: origin.z + direction.z * distance };
    const sampled = bridgeHeight(next.x, next.z);
    if (sampled !== undefined && Math.abs(sampled - next.y) <= 0.02) return next;
    point = next;
  }
  return point;
};

/**
 * Picking and pointer hover with the last frame's camera: ground, buildings, ships and soldiers.
 * Registers the canvas pointer listeners until disposed.
 */
export const createRendererPicking = (
  canvas: HTMLCanvasElement,
  world: PickGround & { seaLevel: number },
  buildings: ReturnType<typeof createThreeBuildings>,
  shipInteraction: ReturnType<typeof createShipInteraction>,
  depositSigns?: ReturnType<typeof createThreeDepositSigns>,
  workers?: { setHover(id: number | null): void },
  roadDecorations?: { pick(ray: Raycaster): { uid: number; distance: number } | undefined; setHover?(uid: number | null): boolean },
  bridgeHeight?: (x: number, z: number) => number | undefined,
  bridges?: Pick<ReturnType<typeof createThreeBridges>, "pickHit" | "setHover">,
  /** FISHER-POLISH: a Fishery's skiff (yard, shore or afloat) picks its Fishery. */
  fishingBoats?: { pickHit(ray: Raycaster): { distance: number; id: number } | undefined }
) => {
  const depositTooltip = depositSigns ? createDepositSignTooltip(canvas) : undefined;
  let lastCamera: Camera | null = null;
  let lastState: FrameState["camera"] | null = null;
  let lastWorkers: readonly WorkerFrame[] = [];
  let hoverPointer: { x: number; y: number; clientX: number; clientY: number } | undefined;
  let lastHoverCheck = 0;
  /** The soldiers' hover target: while set, it replaces this module's own hover pick (military controls P3). */
  let armyTarget: ArmyTargetHoverOutline | null = null;
  let armyTargetApplied = false;
  const pickBuilding = (x: number, y: number) => {
    if (!lastCamera || !lastState) return null;
    pickPointer.set((x / lastState.viewportWidth) * 2 - 1, 1 - y / lastState.viewportHeight * 2);
    pickRaycaster.setFromCamera(pickPointer, lastCamera);
    const building = buildings.pickHit(pickRaycaster), boat = fishingBoats?.pickHit(pickRaycaster);
    if (boat && (!building || boat.distance < building.distance)) return String(boat.id);
    return building?.id ?? null;
  };
  /** A bridge under the pointer, unless a building stands in front of it. */
  const pickBridge = (x: number, y: number) => {
    if (!bridges || !lastCamera || !lastState) return null;
    pickPointer.set((x / lastState.viewportWidth) * 2 - 1, 1 - y / lastState.viewportHeight * 2);
    pickRaycaster.setFromCamera(pickPointer, lastCamera);
    const hit = bridges.pickHit(pickRaycaster);
    const building = hit && buildings.pickHit(pickRaycaster);
    return hit && (!building || hit.distance < building.distance) ? hit.id : null;
  };
  const pickRoadDecoration = (x: number, y: number) => {
    if (!lastCamera || !lastState || !roadDecorations) return null;
    pickPointer.set((x / lastState.viewportWidth) * 2 - 1, 1 - y / lastState.viewportHeight * 2);
    pickRaycaster.setFromCamera(pickPointer, lastCamera);
    const hit = roadDecorations.pick(pickRaycaster), building = hit && buildings.pickHit(pickRaycaster);
    const ship = hit && shipInteraction.pickHit(pickRaycaster);
    return hit && (!building || hit.distance < building.distance) && (!ship || hit.distance < ship.distance) ? hit.uid : null;
  };
  const pickShip = (x: number, y: number) => {
    if (!lastCamera || !lastState) return null;
    pickPointer.set((x / lastState.viewportWidth) * 2 - 1, 1 - y / lastState.viewportHeight * 2);
    pickRaycaster.setFromCamera(pickPointer, lastCamera);
    const hit = shipInteraction.pickHit(pickRaycaster);
    const building = hit && buildings.pickHit(pickRaycaster);
    return hit && (!building || hit.distance < building.distance) ? hit.id : null;
  };
  /** The nearest visible soldier's chest under the pointer (screen-space, matching army clicks). */
  const pickSoldier = (x: number, y: number) => {
    if (!workers || !lastCamera || !lastState) return null;
    let nearest: { distance: number; id: number } | undefined;
    for (const frame of lastWorkers) {
      if (frame.workerJob !== "Soldier" || frame.actorId === undefined || frame.visible === false) continue;
      const worldY = bridgeHeight?.(frame.x, frame.z) ?? frame.y;
      const screen = projectWithCamera(lastCamera, lastState, frame.x, worldY + .55, frame.z);
      if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;
      const distance = Math.hypot(screen.x - x, screen.y - y);
      if (distance <= SOLDIER_HOVER_RADIUS && (!nearest || distance < nearest.distance))
        nearest = { distance, id: frame.actorId };
    }
    return nearest?.id ?? null;
  };
  const clearHover = () => {
    hoverPointer = undefined; buildings.setHover(null); shipInteraction.setHover(null);
    roadDecorations?.setHover?.(null); bridges?.setHover(null);
    workers?.setHover(null);
    depositSigns?.setHover(null); depositTooltip?.hide();
    if (canvas.style.cursor === HOVER_POINTER_CURSOR) canvas.style.cursor = "";
  };
  const moveHover = (event: PointerEvent) => {
    if (event.pointerType === "touch") { clearHover(); return; }
    const rect = canvas.getBoundingClientRect();
    hoverPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top,
      clientX: event.clientX, clientY: event.clientY };
    lastHoverCheck = 0;
  };
  const finishTouchHover = (event: PointerEvent) => { if (event.pointerType === "touch") clearHover(); };
  canvas.addEventListener("pointerup", finishTouchHover);
  canvas.addEventListener("pointermove", moveHover);
  canvas.addEventListener("pointerleave", clearHover);
  const updateDepositHover = (enabled: boolean) => {
    const deposit = enabled ? depositSigns?.pickHit(pickRaycaster) : null;
    depositSigns?.setHover(deposit?.id ?? null);
    if (deposit && hoverPointer) depositTooltip?.show(deposit.label, hoverPointer.clientX, hoverPointer.clientY);
    else depositTooltip?.hide();
    return Boolean(deposit);
  };
  /** Outlines the army target only (no ray casts): applied once per change, the next frame. */
  const applyArmyTarget = (target: ArmyTargetHoverOutline) => {
    armyTargetApplied = true;
    roadDecorations?.setHover?.(null); bridges?.setHover(null);
    depositSigns?.setHover(null); depositTooltip?.hide();
    buildings.setHover(target.buildingId ?? null, true);
    shipInteraction.setHover(target.shipId ?? null);
    workers?.setHover(target.soldierId ?? null);
  };
  const setArmyTargetHover = (target: ArmyTargetHoverOutline | null) => {
    armyTarget = target;
    armyTargetApplied = false;
    if (!target) { buildings.setHover(null); lastHoverCheck = 0; }
  };
  /** Hover outlines and the pointer cursor, checked at most every 100 ms. */
  const updateHover = () => {
    if (armyTarget) {
      if (!armyTargetApplied) applyArmyTarget(armyTarget);
      return;
    }
    const now = performance.now();
    if (!hoverPointer || now - lastHoverCheck < 100) return;
    lastHoverCheck = now;
    const unobscured = document.elementFromPoint(hoverPointer.clientX, hoverPointer.clientY) === canvas;
    const decorationId = unobscured ? pickRoadDecoration(hoverPointer.x, hoverPointer.y) : null;
    const decorationHovered = roadDecorations?.setHover?.(decorationId) ?? false;
    const shipId = unobscured && !decorationHovered ? pickShip(hoverPointer.x, hoverPointer.y) : null;
    shipInteraction.setHover(shipId);
    const buildingId = unobscured && !decorationHovered && shipId === null ? pickBuilding(hoverPointer.x, hoverPointer.y) : null;
    const deposit = updateDepositHover(unobscured && !decorationHovered && shipId === null && buildingId === null && lastCamera !== null);
    const buildingHovered = buildings.setHover(buildingId);
    const soldierId = unobscured && !decorationHovered && shipId === null && !buildingHovered && !deposit
      ? pickSoldier(hoverPointer.x, hoverPointer.y) : null;
    workers?.setHover(soldierId);
    const bridgeId = unobscured && !decorationHovered && shipId === null && !buildingHovered && !deposit &&
      soldierId === null ? pickBridge(hoverPointer.x, hoverPointer.y) : null;
    const bridgeHovered = bridges?.setHover(bridgeId) ?? false;
    if (!canvas.style.cursor || canvas.style.cursor === HOVER_POINTER_CURSOR) {
      canvas.style.cursor = decorationHovered || shipId !== null || buildingHovered || deposit || soldierId !== null ||
        bridgeHovered ? HOVER_POINTER_CURSOR : "";
    }
  };
  return {
    dispose: () => {
      roadDecorations?.setHover?.(null);
      depositSigns?.setHover(null);
      workers?.setHover(null);
      depositTooltip?.dispose();
      canvas.removeEventListener("pointerup", finishTouchHover);
      canvas.removeEventListener("pointermove", moveHover);
      canvas.removeEventListener("pointerleave", clearHover);
    },
    pickBridge,
    pickBuilding,
    pickRoadDecoration,
    pickGround: (x: number, y: number) => pickWithCamera(world, lastCamera, lastState, x, y, bridgeHeight),
    pickShip,
    setArmyTargetHover,
    pickWater: (x: number, y: number) => {
      if (!lastCamera || !lastState) return null;
      pickPointer.set((x / lastState.viewportWidth) * 2 - 1, 1 - y / lastState.viewportHeight * 2);
      pickRaycaster.setFromCamera(pickPointer, lastCamera);
      const { direction, origin } = pickRaycaster.ray;
      if (Math.abs(direction.y) < 1e-9) return null;
      const distance = (world.seaLevel - origin.y) / direction.y;
      if (distance < 0) return null;
      const point = { x: origin.x + direction.x * distance, y: world.seaLevel,
        z: origin.z + direction.z * distance };
      if (point.x < 0 || point.z < 0 || point.x >= world.cellsX || point.z >= world.cellsZ) return null;
      const ground = pickGroundAlongRay(world, pickRaycaster.ray);
      if (ground && ground.y > world.seaLevel + .015) return null;
      return point;
    },
    projectToViewport: (x: number, y: number, z: number) => projectWithCamera(lastCamera, lastState, x, y, z),
    /** The camera of the frame just drawn: picking and projection follow it. */
    setView: (camera: Camera, state: FrameState["camera"], workers: readonly WorkerFrame[] = []) => {
      lastCamera = camera;
      lastState = state;
      lastWorkers = workers;
    },
    updateHover
  };
};
