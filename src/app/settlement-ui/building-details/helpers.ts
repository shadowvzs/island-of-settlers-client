import type { I18n } from "@lingui/core";

import { getNationBuildingDefinition } from "../../../render-common/buildings/nation-building-text";
import { translateMessage } from "../../../shared/i18n/translate";
import { isMaterialQuarry, materialBuildingGroup } from "../../../shared/settlement/advanced-material-production";
import {
  ARMORY_TYPE_ID, BuildingType, COMMANDER_LODGE_TYPE_ID, FARM_TYPE_ID, FISHERY_TYPE_ID, FLAX_FARM_TYPE_ID,
  HARBOUR_TYPE_ID, QUARRY_TYPE_ID, SHIPYARD_TYPE_ID
} from "../../../shared/settlement/building-type-ids";
import type { ShuttleStatus } from "../../../shared/settlement/harbour-shuttle-plan";
import { PRODUCTION_RULES, STORAGE_IDS } from "../../../shared/settlement/production-rules";
import { RESIDENCE_IDS } from "../../../shared/settlement/residences";
import { joinDetails } from "../../components/helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary, SettlementUiOptions, SettlementUiSnapshot } from "../types";
import { WORKER_PHASE_MESSAGES as WP } from "../worker-phase-messages";
import { hasWorkshopUpgrade } from "./upgrade-helpers";

/** What the details window reads from the snapshot: the focused building and the few totals it shows. */
export interface BuildingDetailsData {
  activeColony?: number | null;
  building?: SettlementBuildingSummary;
  expeditionOngoing?: boolean;
  colonyTroops?: SettlementUiSnapshot["colonyTroops"];
  colonyIslands?: SettlementUiSnapshot["colonyIslands"];
  adventureIslands?: SettlementUiSnapshot["adventureIslands"];
  idleExpeditionShips?: number;
  expeditionPreparations?: SettlementUiSnapshot["expeditionPreparations"];
  features?: SettlementUiSnapshot["features"];
  harbourShuttle?: ShuttleStatus;
  level: number;
  nation?: string;
  resources?: SettlementUiSnapshot["resources"];
  seaOrders?: SettlementUiSnapshot["seaOrders"];
  shippingDemands?: SettlementUiSnapshot["shippingDemands"];
}

/**
 * The focused building and its context; compare with `isDeepEqual` (the snapshot rebuilds every building
 * object each 0.5 s tick, so reference equality would re-render an unchanged window every tick).
 */
export const selectBuildingDetails = (snapshot: Readonly<SettlementUiSnapshot>): BuildingDetailsData => {
  const building = snapshot.focusedBuilding
    ? snapshot.buildings?.find(candidate => candidate.id === snapshot.focusedBuilding)
    : undefined;
  // Realm totals and voyages only for the sections that show them, so other ticks compare equal.
  const harbour = building?.type === HARBOUR_TYPE_ID;
  return {
    activeColony: snapshot.activeColony,
    colonyTroops: harbour ? snapshot.colonyTroopsByHarbour?.[Number(building.id)] ?? snapshot.colonyTroops : undefined,
    colonyIslands: harbour ? snapshot.colonyIslands : undefined,
    adventureIslands: harbour ? snapshot.adventureIslands : undefined,
    idleExpeditionShips: harbour ? snapshot.idleExpeditionShips : undefined,
    building,
    expeditionOngoing: harbour ? snapshot.expeditionOngoing : undefined,
    expeditionPreparations: harbour ? snapshot.expeditionPreparations : undefined,
    features: harbour ? snapshot.features : undefined,
    harbourShuttle: harbour ? snapshot.harbourShuttles?.find(status => status.uid === Number(building.id)) : undefined,
    level: snapshot.player?.level ?? 1,
    nation: snapshot.playerNation,
    resources: building?.tavern ? snapshot.resources : undefined,
    seaOrders: harbour ? snapshot.seaOrders : undefined,
    shippingDemands: snapshot.shippingDemands
  };
};

/** Window title: the building's own name (a camp's display name), else the nation's building name. */
export const getBuildingDetailsTitle = (
  building: SettlementBuildingSummary | undefined, nation?: string, i18n?: I18n
) => {
  if (!building) return translateMessage(i18n, M.details.title);
  return building.displayName ?? getNationBuildingDefinition(building.type, nation).name;
};

const isStorageBuilding = (building: Pick<SettlementBuildingSummary, "type">) =>
  STORAGE_IDS.has(building.type);

/** "status · worker", empty when neither is reported. */
export const getActivityText = ({ status, worker }: SettlementBuildingSummary) =>
  joinDetails(status, worker);

/** Read-only current worker phase, remaining fixed-clock time and effective rate. */
export const getWorkerPhaseText = (building: SettlementBuildingSummary, i18n?: I18n) => {
  const spec = building.workerPhase;
  if (!spec || spec.clock === "inactive") return null;
  const parts = [translateMessage(i18n, WP.clock[spec.clock])];
  if (spec.remainingSeconds !== undefined && spec.remainingSeconds > 0)
    parts.push(translateMessage(i18n, WP.remaining, {
      seconds: Math.round(spec.remainingSeconds * 10) / 10
    }));
  if (spec.rateApplies && Math.abs(spec.rate - 1) > 0.005)
    parts.push(translateMessage(i18n, WP.rate, { percent: Math.round(spec.rate * 100) }));
  return joinDetails(...parts);
};

/** Live work progress caption, accessible name and value text; null while the building reports none. */
export const getWorkProgress = (building: SettlementBuildingSummary, i18n?: I18n) => {
  if (building.workProgress === undefined) return null;
  const label = building.workProgressLabel ?? translateMessage(i18n, M.details.workProgress);
  const text = translateMessage(i18n, M.details.workProgressText, {
    label, percent: Math.round(building.workProgress * 100)
  });
  return { label, text, value: building.workProgress };
};

/** Finite outcrop note of a marble/granite quarry; null for any other building. */
export const getQuarryNote = (building: SettlementBuildingSummary, i18n?: I18n) => {
  if (!isMaterialQuarry(building.type)) return null;
  return translateMessage(i18n, M.details.quarryNote, {
    count: building.marbleRemaining ?? 0, stone: materialBuildingGroup(building.type)!.stone
  });
};

/** The completed Monument's bonus line; null for every other building. */
export const getMonumentNote = (building: SettlementBuildingSummary, i18n?: I18n) => {
  if (building.type !== BuildingType.Monument || !building.completed) return null;
  return translateMessage(i18n, M.details.monumentNote);
};

/** Stop / Resume production applies to completed producers (not services) when the command exists. */
const canPauseProduction = (building: SettlementBuildingSummary, options: SettlementUiOptions) => {
  const rule = PRODUCTION_RULES[building.type];
  return Boolean(building.completed && rule && !rule.service && options.onProductionPaused);
};

export const getPauseCaption = (paused: boolean, i18n?: I18n) =>
  translateMessage(i18n, paused ? M.details.resume : M.details.pause);

/** Demolish applies to everything but the headquarters and buildings that refuse it. */
const canDemolish = (building: SettlementBuildingSummary, options: SettlementUiOptions) =>
  Boolean(options.onDemolishBuilding) && building.canDemolish !== false && building.type !== 0;

/** Which sections a completed building shows, in the window's order. */
export const getCompletedSections = (
  building: SettlementBuildingSummary, data: BuildingDetailsData, options: SettlementUiOptions
) => {
  const storage = isStorageBuilding(building), residence = RESIDENCE_IDS.has(building.type);
  return {
    armory: building.type === ARMORY_TYPE_ID && Boolean(options.onProductionOrder),
    commander: building.type === COMMANDER_LODGE_TYPE_ID && Boolean(building.commander || building.commanderRecruit),
    farm: building.type === FARM_TYPE_ID || building.type === FLAX_FARM_TYPE_ID,
    fisherMode: building.type === FISHERY_TYPE_ID && Boolean(building.fisherBoat && options.onFisherMode),
    garrison: Boolean(building.garrison && options.onGarrisonComposition),
    harbour: building.type === HARBOUR_TYPE_ID && Boolean(building.completed) && data.activeColony == null,
    producedWares: !storage && !residence,
    production: !storage && !residence,
    productionMode: Boolean(options.onProductionMode),
    residence: Boolean(building.residence),
    shipyardMode: building.type === SHIPYARD_TYPE_ID && Boolean(options.onShipyardMode),
    soldiers: building.soldiers !== undefined,
    stone: building.type === QUARRY_TYPE_ID,
    storage,
    tavern: Boolean(building.tavern)
  };
};

export type CompletedSections = ReturnType<typeof getCompletedSections>;

/** The action row: storage tools and page toggle, Stop / Resume production, Demolish; null when empty. */
export const getFooterActions = (
  building: SettlementBuildingSummary, options: SettlementUiOptions,
  storagePage: import("./storage-helpers").StoragePage
) => {
  const storage = building.completed !== false && isStorageBuilding(building);
  const actions = {
    demolish: canDemolish(building, options),
    pause: building.completed !== false && canPauseProduction(building, options),
    storagePage: storage,
    storageTools: storage && storagePage === "resources" && Boolean(building.storageCollect?.visible),
    upgrade: hasWorkshopUpgrade(building, options)
  };
  return Object.values(actions).some(Boolean) ? actions : null;
};

export type FooterActions = NonNullable<ReturnType<typeof getFooterActions>>;
