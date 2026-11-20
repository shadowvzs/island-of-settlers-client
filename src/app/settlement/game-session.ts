import { isFiniteNumber, isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import type { CameraState } from "../../render-common/camera-state";
import {
  type AnimalSaveState,
  validateAnimalSave} from "../../render-common/wildlife/manager/animal-save";
import { type LoadedGameSave,readGameSave } from "../../shared/settlement/game-save";
import { levelRoadGround } from "../../shared/settlement/road-ground-leveling";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { updateSettlementGroundClearance } from "../../shared/settlement/settlement-ground-clearance";
import { validateSettlementSave } from "../../shared/settlement/settlement-save-state";
import { clearAdventureDeposits } from "../../shared/world/generation/adventure-deposits";
import { type CameraBookmark,validCameraBookmarks } from "../camera-bookmarks";
import type { createEnvironmentController } from "../environment-controller";
import type { createIslandFelling } from "../island-felling";
import type { createIslandGrowth } from "../island-growth";
import { colonySettlementOptions } from "./colony-boot";
import { type IslandStoneLedgerState, validIslandStoneLedger } from "./island-stone-ledger";

export interface GameRuntimeState {
  animals?: AnimalSaveState;
  bookmarks?: CameraBookmark[];
  viewMode?: "iso" | "cinematic";
  environment?: ReturnType<ReturnType<typeof createEnvironmentController>["saveState"]>;
  growth: ReturnType<ReturnType<typeof createIslandGrowth>["saveState"]>;
  felling: ReturnType<ReturnType<typeof createIslandFelling>["saveState"]>;
  camera: Pick<CameraState, "centerX" | "centerZ" | "zoom" | "yaw" | "tilt">;
  /** Worked quarry amounts (boulders, formations, mountain seams). */
  stone?: IslandStoneLedgerState;
}
const ids = (value: unknown, count: number) =>
  Array.isArray(value) && value.every((id) => Number.isSafeInteger(id) && id >= 0 && id < count);
const entries = (value: unknown, count: number, second: (value: unknown) => boolean) =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      Array.isArray(entry) && entry.length === 2 && ids([entry[0]], count) && second(entry[1])
  );

/** All loading work happens on a detached map and simulation before a reload is scheduled. */
export const stageGameSession = async (value: unknown): Promise<LoadedGameSave> => {
  const loaded = await readGameSave(value),
    { world } = loaded.map;
  const roads = createRoadNetwork(world);
  const reason = validateSettlementSave(loaded.settlement, { options: { world, roads, ...colonySettlementOptions(loaded, null) } });
  if (reason) throw new Error(reason);
  if (!roads.replaceSegments(loaded.settlement.roads)) throw new Error("Invalid saved road network");
  if (loaded.runtime !== undefined) {
    if (!isPlainObject(loaded.runtime)) throw new Error("Invalid saved runtime state");
    if (loaded.runtime.bookmarks !== undefined && !validCameraBookmarks(loaded.runtime.bookmarks))
      throw new Error("Invalid saved camera bookmarks");
    const { camera, felling, growth } = loaded.runtime,
      count = world.props.count;
    if (loaded.runtime.animals !== undefined) {
      // Restore into detached pools during validation; no live animals or resource IDs change.
      validateAnimalSave(loaded.runtime.animals as AnimalSaveState);
    }
    if (
      !isPlainObject(growth) ||
      !isFiniteNumber(growth.now) ||
      typeof growth.running !== "boolean" ||
      !(Number.isFinite(growth.speed) && (growth.speed as number) > 0) ||
      !ids(growth.trees, count) ||
      !ids(growth.grown, count) ||
      !ids(growth.jobPlanted, count) ||
      !entries(growth.planted, count, isFiniteNumber) ||
      !entries(growth.removed, count, (item) => typeof item === "boolean")
    )
      throw new Error("Invalid saved tree growth");
    if (
      !isPlainObject(felling) ||
      !isFiniteNumber(felling.now) ||
      !isFiniteNumber(felling.randomState) ||
      !isPlainObject(felling.controller) ||
      !isFiniteNumber(felling.controller.lastTime) ||
      !entries(felling.fallYaws, count, isFiniteNumber) ||
      !entries(
        felling.controller.fellings,
        count,
        (item) => isPlainObject(item) && isFiniteNumber(item.start) && isFiniteNumber(item.fallYaw) &&
          (item.rate === undefined || (isFiniteNumber(item.rate) && item.rate > 0))
      )
    )
      throw new Error("Invalid saved tree felling");
    if (loaded.runtime.stone !== undefined && !validIslandStoneLedger(loaded.runtime.stone, count))
      throw new Error("Invalid saved quarry amounts");
    if (
      loaded.runtime.viewMode !== undefined &&
      !["iso", "cinematic"].includes(loaded.runtime.viewMode as string)
    )
      throw new Error("Invalid saved camera view");
    const weather = loaded.runtime.environment;
    if (
      weather !== undefined &&
      (!isPlainObject(weather) ||
        typeof weather.cycling !== "boolean" ||
        ![weather.hour, weather.targetHour].every(
          (value) => isFiniteNumber(value) && value >= 0 && value <= 24
        ) ||
        ![weather.rain, weather.targetRain, weather.snow, weather.targetSnow].every(
          (value) => isFiniteNumber(value) && value >= 0 && value <= 1
        ))
    )
      throw new Error("Invalid saved weather");
    if (
      !isPlainObject(camera) ||
      ![camera.centerX, camera.centerZ, camera.zoom, camera.yaw, camera.tilt].every(isFiniteNumber)
    )
      throw new Error("Invalid saved camera");
  }
  if (loaded.settlement.adventure) {
    world.expeditionTheme = loaded.settlement.adventure.island.theme;
    clearAdventureDeposits(world);
  }
  // Repair in the loading worker before any terrain, rock or road mesh samples these heights.
  levelRoadGround(world, loaded.settlement.roads, loaded.settlement.buildings);
  updateSettlementGroundClearance(world, loaded.settlement.roads, loaded.settlement.buildings);
  world.settlementRoadTerrainPrepared = true;
  return loaded;
};
