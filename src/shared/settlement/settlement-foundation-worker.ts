import { sampleSmooth } from "../world/grid-geometry";
import { bumpBuildRevision } from "../world/save/world-change-journal";
import { levelBuildingFoundation, levelBuildingFoundationTile } from "./settlement-foundation";
import { beginFoundationChange, finishFoundationChange } from "./settlement-foundation-changes";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

export const FOUNDATION_TILE_SECONDS = 3.6;

/** A serpentine visit of every one-cell tile, starting at the entrance-facing corner. */
export const foundationTiles = (building: SettlementBuilding) => {
  const left = building.x - building.width / 2, top = building.z - building.depth / 2;
  const tiles: Array<{ x: number; z: number }> = [];
  const fromTop = building.access.z < building.z, fromLeft = building.access.x <= building.x;
  for (let row = 0; row < building.depth; row++) {
    const z = top + (fromTop ? row : building.depth - row - 1);
    const forward = row % 2 === 0 ? fromLeft : !fromLeft;
    for (let column = 0; column < building.width; column++)
      tiles.push({ x: left + (forward ? column : building.width - column - 1), z });
  }
  return tiles;
};

const approachTile = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  const tile = foundationTiles(building)[building.foundationTileIndex ?? 0];
  if (!tile) return;
  actor.stockBuilding = building.uid;
  const path = groundPath(context, actor, { x: tile.x + .5, z: tile.z + .5 }, building.uid);
  if (path) setActorPath(actor, path, "levelApproach");
  else {
    actor.phase = "levelWaiting"; actor.timer = 1; actor.action = "idle";
    building.status = "Waiting for clear leveling access";
  }
};

/** Levelled ground moves under everyone standing on the apron; keep their feet on the new surface. */
export const refreshActorsOnLeveledGround = (
  context: SettlementContext, region: { minX: number; minZ: number; maxX: number; maxZ: number }
) => {
  const { world } = context.options;
  for (const actor of context.actors) {
    if (!actor.visible || actor.x < region.minX || actor.x > region.maxX + 1 ||
      actor.z < region.minZ || actor.z > region.maxZ + 1) continue;
    actor.y = sampleSmooth(world, world.heights, actor.x, actor.z);
  }
};

const leaveLeveledSite = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  building.working = false;
  building.status = "Leaving leveled site";
  const path = groundPath(context, actor, building.access, building.uid);
  if (path) setActorPath(actor, path, "levelExit");
  else {
    actor.phase = "levelWaiting"; actor.timer = 1; actor.action = "idle";
    building.status = "Waiting for clear leveling exit";
  }
};

/** Tile work is saved separately from walking; construction remains gated until all tiles finish. */
export const updateFoundationWorker = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding, dt: number,
  returnHome: () => void
) => {
  if (actor.job !== "Leveler") return false;
  if (actor.phase === "levelWaiting") {
    actor.timer -= dt;
    if (actor.timer <= 0) {
      if ((building.foundationProgress ?? 0) >= 1) leaveLeveledSite(context, actor, building);
      else approachTile(context, actor, building);
    }
    return true;
  }
  if (actor.phase === "levelExit") {
    if (!moveActor(context, actor, dt)) return true;
    building.worker = undefined; building.status = "Waiting for builder and supplies";
    actor.job = "Settler"; actor.action = "idle";
    // The founding operation owns its landing crew; it settles them into the finished outpost.
    if (building.foundedByExpedition) {
      actor.phase = "foundingWait"; actor.path = []; actor.pathIndex = 0;
      return true;
    }
    returnHome();
    return true;
  }
  if (actor.phase === "assigned" || actor.phase === "levelApproach") {
    if (!moveActor(context, actor, dt)) return true;
  if (actor.phase === "assigned") { approachTile(context, actor, building); return true; }
    actor.phase = "levelTile"; actor.action = "work"; actor.animationTime = 0; actor.visible = true;
    actor.yaw = building.access.z < building.z ? Math.PI : 0;
  }
  // Earlier in-flight saves used one exterior work stance. Resume at the first unvisited tile.
  if (actor.phase === "levelFoundation") { approachTile(context, actor, building); return true; }
  if (actor.phase !== "levelTile") return false;
  const tiles = foundationTiles(building), index = building.foundationTileIndex ?? 0;
  if (index >= tiles.length) {
    building.foundationProgress = 1;
    leaveLeveledSite(context, actor, building);
    return true;
  }
  building.working = true;
  building.foundationTileWork = Math.min(FOUNDATION_TILE_SECONDS, (building.foundationTileWork ?? 0) + dt);
  building.foundationProgress = (index + building.foundationTileWork / FOUNDATION_TILE_SECONDS) / tiles.length;
  building.status = `Leveling tile ${index + 1}/${tiles.length}`;
  if (building.foundationTileWork < FOUNDATION_TILE_SECONDS) return true;
  const existing = context.buildings.filter(other => other.uid !== building.uid), tile = tiles[index]!;
  const change = beginFoundationChange(context.options.world, building);
  const region = levelBuildingFoundationTile(context.options.world, building, tile.x, tile.z, existing);
  building.foundationTileIndex = index + 1; building.foundationTileWork = 0;
  bumpBuildRevision(context.options.world, null);
  finishFoundationChange(context.options.world, change);
  if (region) {
    context.options.onFoundationLeveled?.(building, region);
    refreshActorsOnLeveledGround(context, region);
  }
  if (index + 1 < tiles.length) { building.working = false; approachTile(context, actor, building); return true; }
  const apron = levelBuildingFoundation(context.options.world, building, existing);
  if (apron) {
    context.options.onFoundationLeveled?.(building, apron);
    refreshActorsOnLeveledGround(context, apron);
  }
  building.foundationProgress = 1;
  leaveLeveledSite(context, actor, building);
  return true;
};
