import type { I18n } from "@lingui/core";

import type { FellingWorkProgress } from "../../render-common/felling/tree-felling";
import { translateMessage } from "../../shared/i18n/translate";
import { FISHING_WORK_TIMING, FORESTER_PLANT_SECONDS } from "../../shared/settlement/outdoor-work-timing";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import { HUNT_DRAW_SECONDS, HUNT_RELEASE_PROGRESS } from "../../shared/settlement/settlement-hunting";
import { ownerOf } from "../../shared/settlement/settlement-ownership";
import type { ProductionRule, SettlementActor, SettlementBuilding } from "../../shared/settlement/settlement-types";
import { WHEAT_SOW_SECONDS } from "../../shared/settlement/settlement-wheat-planning";
import { SETTLEMENT_MESSAGES as M } from "../settlement-ui/messages";
import { fisherBoatWorkStep } from "./fisher-boat-work-progress";

export interface ProductionWorkProgress {
  workProgress?: number;
  workProgressLabel?: string;
}
const progress = (value: number, label: string): ProductionWorkProgress => {
  if (!Number.isFinite(value)) return {};
  return { workProgress: Math.round(Math.max(0, Math.min(1, value)) * 100) / 100,
    workProgressLabel: label };
};
const remainingProgress = (remaining: number, duration: number, label: string) =>
  duration > 0 ? progress(1 - remaining / duration, label) : {};

/** Read saved work clocks only. Walking, fetching, blocked retries and idle periods have no bar. */
export const productionWorkProgress = (
  building: SettlementBuilding, actor: SettlementActor | undefined, rule: ProductionRule | undefined,
  readFelling?: (id: number) => FellingWorkProgress | undefined, i18n?: I18n
): ProductionWorkProgress => {
  if (building.construction !== 1 || STORAGE_IDS.has(building.typeId) ||
    ownerOf(building) > 0 || !actor || !rule || rule.service) return {};
  if (actor.phase === "waitTreeFall") {
    const felling = actor.target && readFelling?.(actor.target.id);
    return felling ? progress(felling.progress, translateMessage(i18n,
      felling.phase === "chopping" ? M.status.progressChopping : M.status.progressTreeFalling)) : {};
  }
  if (actor.phase === "foresterPlant")
    return remainingProgress(actor.timer, FORESTER_PLANT_SECONDS, translateMessage(i18n, M.status.progressPlanting));
  if (actor.phase === "huntAim") {
    const elapsed = HUNT_DRAW_SECONDS - actor.timer;
    return progress(elapsed / (HUNT_DRAW_SECONDS * HUNT_RELEASE_PROGRESS),
      translateMessage(i18n, M.status.progressDrawingBow));
  }
  if (actor.phase === "huntFlight" && actor.huntArrow)
    return remainingProgress(actor.timer, actor.huntArrow.duration, translateMessage(i18n, M.status.progressArrow));
  const boatStep = fisherBoatWorkStep(actor, i18n);
  if (boatStep) return remainingProgress(boatStep.remaining, boatStep.duration, boatStep.label);
  const { cast, reel, wait } = FISHING_WORK_TIMING;
  const fishingDuration = cast + wait + reel;
  if (actor.phase === "fishCast")
    return progress((cast - actor.timer) / fishingDuration, translateMessage(i18n, M.status.progressCasting));
  if (actor.phase === "fishWait")
    return progress((cast + wait - actor.timer) / fishingDuration, translateMessage(i18n, M.status.progressWaitingBite));
  if (actor.phase === "fishReel")
    return progress(1 - actor.timer / fishingDuration, translateMessage(i18n, M.status.progressReeling));
  if (!["work", "wellWork"].includes(actor.phase) || actor.action === "idle") return {};
  if (actor.fieldWork === "sow")
    return remainingProgress(actor.timer, WHEAT_SOW_SECONDS, translateMessage(i18n, M.status.progressSowing));
  if (actor.fieldWork === "harvest")
    return remainingProgress(actor.timer, actor.productionSeconds ?? rule.seconds,
      translateMessage(i18n, M.status.progressHarvesting));
  const label = breedingLabel(building.typeId, i18n)
    ?? translateMessage(i18n, actor.phase === "wellWork" ? M.status.progressDrawingWater : M.status.progressWorking);
  return remainingProgress(actor.timer, actor.productionSeconds ?? rule.seconds, label);
};
const breedingLabel = (type: number, i18n?: I18n) => {
  if (type === 28) return translateMessage(i18n, M.status.progressPigs);
  return undefined;
};
