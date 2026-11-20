import type { I18n } from "@lingui/core";
import {
  type TalentBranch, type TalentDefinition, type TalentEffect, type TalentGroup, type TalentModifier,
  type TalentSubject
} from "@shared/catalog/balance";

import { getNationBuildingDefinition } from "../../../render-common/buildings/nation-building-text";
import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";

export const BRANCH_LABELS = {
  economy: M.talents.branchEconomy,
  logistics: M.talents.branchLogistics,
  military: M.talents.branchMilitary
} as const satisfies Readonly<Record<TalentBranch, unknown>>;
const TALENT_NAMES = {
  adventureExperience: M.talents.nameAdventureExperience, adventureLoot: M.talents.nameAdventureLoot,
  adventureSailing: M.talents.nameAdventureSailing, carrierSpeed: M.talents.nameCarrierSpeed,
  colonyProduction: M.talents.nameColonyProduction, colonyShipInterval: M.talents.nameColonyShipInterval,
  colonyStartSettlers: M.talents.nameColonyStartSettlers, constructionSpeed: M.talents.nameConstructionSpeed,
  doorStrength: M.talents.nameDoorStrength, fieldGrowth: M.talents.nameFieldGrowth,
  handcartCapacity: M.talents.nameHandcartCapacity, hunterFisherSpeed: M.talents.nameHunterFisherSpeed,
  populationLimit: M.talents.namePopulationLimit, productionSpeed: M.talents.nameProductionSpeed,
  questRewards: M.talents.nameQuestRewards, recruitTraining: M.talents.nameRecruitTraining,
  settlerGrowth: M.talents.nameSettlerGrowth, shipping: M.talents.nameShipping,
  siegeDamage: M.talents.nameSiegeDamage, soldierStrength: M.talents.nameSoldierStrength,
  storageCapacity: M.talents.nameStorageCapacity, towerArcherDamage: M.talents.nameTowerArcherDamage,
  tradeOfferSlot: M.talents.nameTradeOfferSlot, treeGrowth: M.talents.nameTreeGrowth
} as const;
/** How each modifier reads; `less` modifiers shorten a time (shown with a minus sign). */
const MODIFIER_TEXT = {
  adventureExperience: { label: M.talents.labelAdventureExperience },
  adventureLoot: { label: M.talents.labelAdventureLoot },
  adventureSailingReduction: { label: M.talents.labelAdventureSailing, less: true },
  carrierSpeed: { label: M.talents.labelCarrierSpeed },
  colonyProductionSpeed: { label: M.talents.labelColonyProduction },
  colonyShipIntervalReduction: { label: M.talents.labelColonyShipInterval, less: true },
  colonyStartSettlers: { count: true, label: M.talents.labelColonyStartSettlers },
  constructionSpeed: { label: M.talents.labelConstructionSpeed },
  dockPorterSpeed: { label: M.talents.labelDockPorterSpeed },
  doorStrength: { label: M.talents.labelDoorStrength },
  fieldGrowthSpeed: { label: M.talents.labelFieldGrowth },
  handcartCapacity: { label: M.talents.labelHandcartCapacity },
  hunterFisherSpeed: { label: M.talents.labelHunterFisherSpeed },
  populationLimit: { label: M.talents.labelPopulationLimit },
  productionSpeed: { label: M.talents.labelProductionSpeed },
  questRewards: { label: M.talents.labelQuestRewards },
  recruitTrainingSpeed: { label: M.talents.labelRecruitTraining },
  settlerGrowthSpeed: { label: M.talents.labelSettlerGrowth },
  shippingTimeReduction: { label: M.talents.labelShipping, less: true },
  siegeDamage: { label: M.talents.labelSiegeDamage },
  soldierDamage: { label: M.talents.labelSoldierDamage },
  soldierHealth: { label: M.talents.labelSoldierHealth },
  storageCapacity: { label: M.talents.labelStorageCapacity },
  towerArcherDamage: { label: M.talents.labelTowerArcherDamage },
  tradeOfferSlots: { count: true, label: M.talents.labelTradeOfferSlots },
  treeGrowthSpeed: { label: M.talents.labelTreeGrowth }
} as const satisfies Readonly<Record<TalentModifier, { count?: true; label: unknown; less?: true }>>;
const GROUP_LABELS = {
  adventures: M.talents.groupAdventures, adventureShips: M.talents.groupAdventureShips,
  builders: M.talents.groupBuilders, carriers: M.talents.groupCarriers, colonies: M.talents.groupColonies,
  colonyShips: M.talents.groupColonyShips, dailyQuests: M.talents.groupDailyQuests,
  dockPorters: M.talents.groupDockPorters, handcarts: M.talents.groupHandcarts,
  productionBuildings: M.talents.groupProductionBuildings, ships: M.talents.groupShips,
  soldiers: M.talents.groupSoldiers, towerArchers: M.talents.groupTowerArchers,
  tradeOffice: M.talents.groupTradeOffice, trees: M.talents.groupTrees
} as const satisfies Readonly<Record<TalentGroup, unknown>>;

export const talentName = (id: string, i18n?: I18n) => {
  const descriptor = TALENT_NAMES[id as keyof typeof TALENT_NAMES];
  return descriptor ? translateMessage(i18n, descriptor) : id;
};

const formatEffect = (
  { modifier, perRank }: TalentEffect, ranks: number, i18n?: I18n
) => {
  const text: { count?: true; label: Parameters<typeof translateMessage>[1]; less?: true } =
    MODIFIER_TEXT[modifier];
  const value = perRank * ranks;
  const amount = text.count ? `${Math.round(value)}` : `${Math.round(value * 100)}%`;
  return translateMessage(i18n, text.less ? M.talents.effectReduction : M.talents.effectBonus, {
    amount, label: translateMessage(i18n, text.label)
  });
};

/** Every effect of `definition` at `ranks`, e.g. "+6% production speed". */
export const formatEffects = (definition: TalentDefinition, ranks: number, i18n?: I18n) =>
  definition.effects.map(effect => formatEffect(effect, ranks, i18n)).join(", ");

const subjectLabel = (subject: TalentSubject, nation: string, i18n?: I18n) =>
  typeof subject === "number"
    ? getNationBuildingDefinition(subject, nation).name
    : translateMessage(i18n, GROUP_LABELS[subject]);

/** "Fishery, Hunter": the buildings (in the player's nation) and groups a talent changes, once each. */
export const formatAffects = (definition: TalentDefinition, nation: string, i18n?: I18n) =>
  [...new Set(definition.affects.map(subject => subjectLabel(subject, nation, i18n)))].join(", ");
