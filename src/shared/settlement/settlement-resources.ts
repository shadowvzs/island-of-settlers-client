import { DMath } from "../math/deterministic-math";
import { removePropsAt } from "../world/editing/prop-removal";
import { isTreePlantingTerrain } from "../world/editing/tree-planting";
import { sampleSmooth } from "../world/grid-geometry";
import { explainWorldNavigationChange, propTileRect } from "../world/navigation-change-log";
import { createStatefulRandom, deriveSeed, shuffle } from "../world/rng";
import { BLOCKING, PROP, PROP_REMOVED } from "../world/world-data";
import { isMaterialQuarry, materialBuildingGroup, materialPlantingSpecies, materialTargetAllowed } from "./advanced-material-production";
import {
  describeTargetProp, emitStonePickedUp, emitTreeCut, emitTreePlanted, retireBoulder
} from "../script-world/nature/nature-events";
import { queueStoneRespawn } from "./boulder-respawn";
import { consumeMarble, marbleTargets } from "./colony-marble-deposits";
import { roadStripIndex } from "./road-reserved-strip";
import { hasRoadRoute } from "./road-route-helpers";
import { fishingSites, isFishingCastWet } from "./settlement-fishing";
import { huntingApproaches } from "./settlement-hunting";
import { economyOwnerOf } from "./settlement-ownership";
import { resourceApproaches } from "./settlement-resource-approaches";
import { treePlantingClearsRotors } from "./settlement-rotor-clearance";
import { stoneTargetAllowed } from "./settlement-stone-area";
import { productionTalentBonus } from "./settlement-talents";
import type { ResourceTarget, SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { resourceWorkRadius } from "./settlement-work-ranges";
import { outdoorWorkPath } from "./settlement-worker-stock-paths";
import { type AuditedRandom, auditRandom } from "./simulation-random";
import { productionCycleRate } from "./workshop-upgrades";

export const TREE_TYPES = new Set<number>([
  PROP.hardwoodTree, PROP.cedarTree, PROP.walnutTree, PROP.mahoganyTree,
  PROP.broadleafTree,
  PROP.coniferTree,
  PROP.palmTree,
  PROP.birchTree
]);
const plantingRandoms = new WeakMap<SettlementContext, AuditedRandom>();
const plantingRandom = (context: SettlementContext) => {
  let random = plantingRandoms.get(context);
  if (!random) {
    random = auditRandom("forester", createStatefulRandom(deriveSeed(context.options.world.seed, "forester-sites")));
    context.randomAudit?.attach([random]);
    plantingRandoms.set(context, random);
  }
  return random;
};
/** The forester stream, created with the island so the audit lists its state from the start. */
export const attachPlantingRandom = (context: SettlementContext) => { plantingRandom(context); };
export const canPlantAt = (context: SettlementContext, x: number, z: number) => {
  const { roads, world } = context.options;
  // A planted tree blocks its cell: keep it out of every road's reserved stone width.
  if (!isTreePlantingTerrain(world, x, z) || !roadStripIndex(roads).isCellClear(Math.floor(x), Math.floor(z)))
    return false;
  if (!treePlantingClearsRotors(context.buildings, x, sampleSmooth(world, world.heights, x, z), z)) return false;
  const cellX = Math.floor(x),
    cellZ = Math.floor(z);
  // Keep mature crowns and trunks away from walls, entrance lanes and active crops.
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const nx = cellX + dx,
        nz = cellZ + dz;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) continue;
      const cell = nz * world.cellsX + nx;
      if (
        context.occupied[cell] ||
        context.fieldCycles?.isOccupied(nx + 0.5, nz + 0.5) ||
        context.reservations.has(`field:${cell}`)
      )
        return false;
    }
  return true;
};
export const targetKey = (target: ResourceTarget) => `${target.kind}:${target.id}`;
/** Units a source worked through the settlement holds before its first use. */
export const freshResourceAmount = (kind: string) => kind === "stone" ? 6 : 12;
const workSearches = new WeakMap<SettlementBuilding, { kind: ResourceTarget["kind"]; revision: string; offset: number }>();
/** Expensive ground routes per attempt; failed searches resume where they stopped next time. */
const WORK_PATH_ATTEMPTS = 2;

export const findWorkTarget = (
  context: SettlementContext,
  building: SettlementBuilding,
  kind: ResourceTarget["kind"]
) => {
  const { resourceTargets, world } = context.options;
  if (kind === "stone" && world.colonyResourceTier && !isMaterialQuarry(building.typeId)) return null;
  const range = resourceWorkRadius(kind);
  const origin = kind === "stone" ? building.access : building;
  const custom = isMaterialQuarry(building.typeId) && kind === "stone"
    ? marbleTargets(context, materialBuildingGroup(building.typeId)?.stone) : resourceTargets?.(kind, origin, range);
  let targets: ResourceTarget[] = custom ? [...custom] : [];
  if (!custom && (kind === "tree" || kind === "stone")) {
    for (let index = 0; index < world.props.count; index++) {
      const type = world.props.types[index]!;
      const suitable =
        kind === "tree"
          ? TREE_TYPES.has(type) &&
            world.props.scale[index]! >= 0.7 &&
            (context.options.canHarvestTree?.(index) ?? true)
          : type === PROP.largeRock;
      if (suitable)
        targets.push({ id: index, kind, x: world.props.x[index]!, z: world.props.z[index]! });
    }
  }
  if (!custom && ["field", "plant", "fish"].includes(kind)) {
    const left = Math.max(0, Math.floor(building.x - range));
    const top = Math.max(0, Math.floor(building.z - range));
    for (let z = top; z < Math.min(world.cellsZ, building.z + range); z++)
      for (let x = left; x < Math.min(world.cellsX, building.x + range); x++) {
        const id = z * world.cellsX + x;
        if (!world.walkCost[id] || context.occupied[id]) continue;
        if (kind === "plant" && !canPlantAt(context, x + 0.5, z + 0.5)) continue;
        if (
          kind !== "fish" &&
          hasRoadRoute(context.options.roads, { x: x + 0.5, z: z + 0.5 }, { x: x + 0.5, z: z + 0.5 })
        )
          continue;
        if (
          kind === "fish" &&
          ![id - 1, id + 1, id - world.cellsX, id + world.cellsX].some(
            (cell) => world.blocking[cell] === BLOCKING.water
          )
        )
          continue;
        if (kind !== "fish" && (world.buildClass[id]! < 2 || world.buildClass[id]! > 4)) continue;
        targets.push({ id, kind, x: x + 0.5, z: z + 0.5 });
      }
  }
  if (kind === "fish") targets = targets.flatMap(target => fishingSites(context, target));
  if (kind === "plant") shuffle(targets, plantingRandom(context).at("forester.plantingSites", building.uid));
  else
    targets.sort(
      (a, b) =>
        DMath.hypot(a.x - origin.x, a.z - origin.z) -
          DMath.hypot(b.x - origin.x, b.z - origin.z) || a.id - b.id
    );
  const revision = `${world.buildRevision ?? 0}:${context.buildings.length}`;
  let search = workSearches.get(building);
  if (!search || search.kind !== kind || search.revision !== revision) {
    search = { kind, revision, offset: 0 }; workSearches.set(building, search);
  }
  let offset = 0, attempts = 0;
  for (const target of targets) {
    if (
      DMath.hypot(target.x - origin.x, target.z - origin.z) > range ||
      (kind === "stone" && !stoneTargetAllowed(context, building, target)) ||
      context.reservations.has(targetKey(target)) || !materialTargetAllowed(context, building, target)
    )
      continue;
    if (kind === "plant" && !canPlantAt(context, target.x, target.z)) continue;
    if (kind === "tree" && context.options.canHarvestTree?.(target.id) === false) continue;
    if (kind !== "plant" && context.resourceAmounts.get(targetKey(target)) === 0) continue;
    const approaches = kind === "wildlife" ? huntingApproaches(target, building) : resourceApproaches(target);
    for (const approach of approaches) {
      if (offset++ < search.offset) continue;
      if (attempts++ >= WORK_PATH_ATTEMPTS) { search.offset = offset - 1; return null; }
      const path = outdoorWorkPath(context, building, approach);
      if (path) { search.offset = 0; return { target, path }; }
    }
  }
  search.offset = 0;
  return null;
};
/** A quarry stone boulder the last cut removed rests and then respawns at the same spot (fresh amount). */
const queueUsedUpBoulder = (context: SettlementContext, target: ResourceTarget) => {
  if (target.kind !== "stone" || target.id < 0) return;
  if (context.options.world.props.types[target.id] !== PROP_REMOVED) return;
  context.resourceAmounts.delete(targetKey(target));
  retireBoulder(context, target.id);
  queueStoneRespawn(context, "prop", target.id);
};
/**
 * Works `target` once for `building`. With the `worker` given, a map script hears the tree cut, the sapling
 * planted or the stone taken (TRG3b; the prop is described before the work can remove it).
 */
export const consumeWorkTarget = (
  context: SettlementContext, target: ResourceTarget, building?: SettlementBuilding, worker?: SettlementActor
) => {
  if (!context.script || !worker) return consumeTarget(context, target, building);
  const prop = describeTargetProp(context, target), props = context.options.world.props.count;
  const consumed = consumeTarget(context, target, building);
  if (!consumed) return consumed;
  if (target.kind === "tree" && prop) emitTreeCut(context, prop, worker);
  if (target.kind === "stone" && prop) emitStonePickedUp(context, prop, worker, worker.productionOutput ?? "stone");
  if (target.kind === "plant" && context.options.world.props.count > props)
    emitTreePlanted(context, context.options.world.props.count - 1, worker);
  return consumed;
};
/** The felling animation rate of a woodcutter: its economy's production rate (level, talents, nation). */
const fellingRate = (context: SettlementContext, building: SettlementBuilding) =>
  productionCycleRate(building, productionTalentBonus(context, building.typeId, economyOwnerOf(context, building)),
    undefined, context);
const consumeTarget = (context: SettlementContext, target: ResourceTarget, building?: SettlementBuilding) => {
  if (target.kind === "stone" && context.options.world.colonyResourceTier &&
    (!building || !isMaterialQuarry(building.typeId))) return false;
  if (building && !materialTargetAllowed(context, building, target)) return false;
  if (target.kind === "stone" && building && isMaterialQuarry(building.typeId)) return consumeMarble(context, target, materialBuildingGroup(building.typeId)?.stone);
  if (target.kind === "stone" && building?.typeId === 19 && !stoneTargetAllowed(context, building, target)) return false;
  const { options } = context;
  if (target.kind === "tree" && options.canHarvestTree?.(target.id) === false) return false;
  // A road, building, crop or another tree may have appeared while the forester walked here.
  if (target.kind === "plant" && !canPlantAt(context, target.x, target.z)) return false;
  if (target.kind === "fish" && !isFishingCastWet(options.world, target)) return false;
  const consumed = options.consumeResource?.(target);
  if (consumed !== undefined) {
    if (consumed && target.kind === "tree") context.resourceAmounts.set(targetKey(target), 0);
    if (consumed) queueUsedUpBoulder(context, target);
    return consumed;
  }
  if (target.kind === "tree") {
    if (!TREE_TYPES.has(options.world.props.types[target.id]!)) return false;
    if (options.onFellTree) {
      const success = options.onFellTree(target.id, building ? fellingRate(context, building) : 1) !== false;
      if (success) context.resourceAmounts.set(targetKey(target), 0);
      return success;
    }
    explainWorldNavigationChange(options.world, propTileRect(options.world, target.id), () => {
      options.world.props.types[target.id] = PROP_REMOVED;
    });
    return true;
  }
  if (target.kind === "plant") {
    if (!options.onPlantTree) return false;
    // Old in-progress forester saves used the broadleaf marker; their next planting gains real hardwood identity.
    const planting = building && materialPlantingSpecies(building.typeId)
      ? { ...target, treeSpecies: materialPlantingSpecies(building.typeId) } : target;
    return options.onPlantTree(planting) !== false;
  }
  if (target.kind === "field") return true;
  if (target.kind === "wildlife" || target.kind === "carcass") return false;
  const key = targetKey(target);
  const available = context.resourceAmounts.get(key) ?? freshResourceAmount(target.kind);
  if (available <= 0) return false;
  context.resourceAmounts.set(key, available - 1);
  if (target.kind === "stone" && available === 1) removePropsAt(options.world, [target.id]);
  queueUsedUpBoulder(context, target);
  return true;
};

export const savePlantingRandom = (context: SettlementContext) => plantingRandom(context).getState();
export const restorePlantingRandom = (context: SettlementContext, state: number) => {
  plantingRandom(context).setState(state);
};
