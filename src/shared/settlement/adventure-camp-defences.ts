import {
  ARCHER_SCAFFOLD_SITE, banditCampPlan, banditMilitaryTypeId, type BanditSiteRef, isOpenArcherTower,
  placedBanditCamp
} from "../../render-common/buildings/bandit-camp-plan";
import { DMath } from "../math/deterministic-math";
import { campObstaclePreservesPassages } from "./adventure-camp-placement-safety";
import type { AdventureIsland } from "./adventure-rules";
import { difficultyArcherTowers, type DifficultyLevel } from "./difficulty";
import { FACING_PASSES, islandCentre, turnsFacing } from "./enemy-building-facing";
import { siteStructure } from "./fort-assault-rules";
import { militaryGroundPath } from "./military-routing";
import { removeSettlementBuilding } from "./settlement-demolition";
import type { createSettlementMilitary } from "./settlement-military";
import { claimBuilding, makeBuilding, placementReason } from "./settlement-placement";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

type Military = ReturnType<typeof createSettlementMilitary>;
const DEFENCE_DOOR_HP = 150;

/** Most camps remain field battles; only a few put existing troops behind defences. */
const islandDefencePlan = (island: Pick<AdventureIsland, "difficulty" | "seed">): readonly BanditSiteRef[] => {
  const seed = island.seed >>> 0;
  const tower = ARCHER_SCAFFOLD_SITE;
  if (island.difficulty === "easy") return seed % 5 === 0 ? [tower] : [];
  if (island.difficulty === "medium") return seed % 3 === 0 ? [] : [tower];
  return seed % 3 === 0 ? [tower, tower] : [tower];
};

/** The island's defences plus the global difficulty's extra archer towers (enemy scaling table). */
export const adventureDefencePlan = (
  island: Pick<AdventureIsland, "difficulty" | "seed">, level?: DifficultyLevel
): readonly BanditSiteRef[] => {
  const plan = islandDefencePlan(island), extra = difficultyArcherTowers(level);
  return extra ? [...plan, ...Array.from({ length: extra }, () => ARCHER_SCAFFOLD_SITE)] : plan;
};

const clearOfTroops = (context: SettlementContext, site: SettlementBuilding) =>
  !context.actors.some(
    (actor) =>
      actor.visible &&
      Math.abs(actor.x - site.x) < site.width / 2 + 1.1 &&
      Math.abs(actor.z - site.z) < site.depth / 2 + 1.1
  );

/** Reject narrow land bridges before claiming a solid plot; both foot and mounted passages survive. */
const preservesPassages = (context: SettlementContext, site: SettlementBuilding) =>
  campObstaclePreservesPassages(
    context.options.world,
    context.buildings.map((building) => ({
      campId: -1,
      cosine: 1,
      sine: 0,
      kind: "tent" as const,
      halfX: building.width / 2,
      halfZ: building.depth / 2,
      x: building.x,
      z: building.z
    })),
    {
      campId: -1,
      cosine: 1,
      sine: 0,
      kind: "tent",
      halfX: site.width / 2,
      halfZ: site.depth / 2,
      x: site.x,
      z: site.z
    }
  );

/** An unclaimed hostile plot at (x, z) after `turns` quarter turns. */
const defenceCandidate = (
  context: SettlementContext,
  bandit: BanditSiteRef,
  point: SettlementPoint,
  turns: number
) => {
  const blueprint = banditCampPlan(bandit);
  const next = context.nextBuilding;
  const site = makeBuilding(context, banditMilitaryTypeId(bandit), point.x, point.z, turns);
  context.nextBuilding = next;
  return Object.assign(site, placedBanditCamp(bandit, point.x, point.z, turns), {
    bandit,
    enemyCampEnclosure: "building" as const,
    hasDoor: blueprint.kind !== "tower",
    militaryFaction: 1,
    construction: 1,
    foundationProgress: 1,
    required: {}
  });
};

/** The first legal defence plot on rings round `centre`, clear of `camps` and far from the landing `shore`. */
export const findDefenceSite = (
  context: SettlementContext,
  bandit: BanditSiteRef,
  centre: SettlementPoint,
  camps: readonly SettlementPoint[],
  shore: SettlementPoint
) => {
  const blueprint = banditCampPlan(bandit);
  const middle = islandCentre(context.options.world);
  const isLegal = (site: SettlementBuilding) =>
    !placementReason(context, site) &&
    clearOfTroops(context, site) &&
    !!militaryGroundPath(context, shore, site.access) &&
    preservesPassages(context, site);
  const siteAt = (x: number, z: number, ranks: readonly [number, number]) => {
    for (const turns of turnsFacing({ x, z }, middle).slice(...ranks)) {
      const [width, depth] = turns % 2 ? [blueprint.cells[1], blueprint.cells[0]] : blueprint.cells;
      const point = { x: x + (width % 2) / 2, z: z + (depth % 2) / 2 };
      const site = defenceCandidate(context, bandit, point, turns);
      if (isLegal(site)) return site;
    }
    return undefined;
  };
  // The front faces the island centre on any ring plot first; only then the next closest turns.
  for (const ranks of FACING_PASSES) for (const radius of [7, 9, 11])
    for (let step = 0; step < 16; step++) {
      const angle = (step * Math.PI) / 8;
      const x = Math.round(centre.x + DMath.cos(angle) * radius);
      const z = Math.round(centre.z + DMath.sin(angle) * radius);
      if (DMath.hypot(x - shore.x, z - shore.z) < 24) continue;
      // Leave every field-camp assembly and spawn ring open, including neighbouring camps.
      if (
        camps.some(
          (camp) => DMath.hypot(camp.x - x, camp.z - z) < 5.5 + DMath.hypot(...blueprint.cells) / 2
        )
      )
        continue;
      const site = siteAt(x, z, ranks);
      if (site) return site;
    }
  return undefined;
};

/**
 * Claims a found defence plot and garrisons the soldiers `recruit` names once the plot is claimed (so a new soldier
 * never stands on it); an empty or unregistered garrison removes the plot again.
 */
export const garrisonDefenceSite = (
  context: SettlementContext, military: Military, site: SettlementBuilding, recruit: () => readonly number[]
) => {
  claimBuilding(context, site);
  context.nextBuilding++;
  const ids = recruit();
  if (ids.length && military.combat.registerGarrison(site.uid, ids, 1, DEFENCE_DOOR_HP, siteStructure(site)))
    return true;
  removeSettlementBuilding(context, site);
  context.options.onBuildingDemolished?.(site);
  return false;
};

/** Reassigns existing archers/infantry, preserving the adventure's roster, ranks and rewards. */
export const raiseAdventureDefences = (
  context: SettlementContext,
  military: Military,
  island: AdventureIsland,
  camps: readonly SettlementPoint[],
  raised: readonly number[][],
  shore: SettlementPoint
) => {
  adventureDefencePlan(island, context.difficulty).forEach((plan, index) => {
    const camp = index % camps.length;
    const available = military
      .soldiers()
      .filter(
        (soldier) =>
          raised[camp]!.includes(soldier.actor) &&
          !soldier.stationed &&
          soldier.combat?.type !== "cavalry"
      );
    const archers = available.filter((soldier) => soldier.combat?.type === "archer");
    if (!archers.length) return;
    const selected =
      isOpenArcherTower({ bandit: plan })
        ? archers.slice(0, 2)
        : [
            ...archers.slice(0, 1),
            ...available.filter((soldier) => soldier.combat?.type !== "archer").slice(0, 2)
          ];
    const site = findDefenceSite(context, plan, camps[camp]!, camps, shore);
    if (!site) return;
    garrisonDefenceSite(context, military, site, () => selected.map((soldier) => soldier.actor));
  });
};
