import hunterFisherIconUrl from "../../../../assets/ui-icons/talents/hunter-fisher.png?url";
import { troopIcon } from "../../settlement/army-icons";
import { getSettlementBuildingIconSource } from "../building-icons";
import { getSettlementIconSource } from "../icons";
import { getWareIconSource } from "../inventory";
import { progressionIcon } from "../player-hud-helpers";

/**
 * A talent's picture: an existing rendered 3D icon of the game model it improves, or a composite of
 * them (`picture`: hunter & fisher = the meat and fish ware renders).
 */
type TalentIconSpec =
  | { building: number }
  | { picture: string }
  | { progression: Parameters<typeof progressionIcon>[0] }
  | { settlement: string }
  | { troop: Parameters<typeof troopIcon>[1] }
  | { ware: string };

const TALENT_ICONS: Readonly<Record<string, TalentIconSpec>> = {
  adventureExperience: { progression: "level-star" },
  adventureLoot: { ware: "goldOre" },
  adventureSailing: { ware: "boat" },
  carrierSpeed: { settlement: "warehouse" },
  colonyProduction: { building: 12 },
  colonyShipInterval: { ware: "ironOre" },
  colonyStartSettlers: { settlement: "people" },
  constructionSpeed: { ware: "hammer" },
  doorStrength: { building: 2 },
  fieldGrowth: { ware: "grain" },
  handcartCapacity: { ware: "handcart" },
  hunterFisherSpeed: { picture: hunterFisherIconUrl },
  populationLimit: { building: 59 },
  productionSpeed: { building: 33 },
  questRewards: { progression: "quest-scroll" },
  recruitTraining: { building: 40 },
  settlerGrowth: { building: 57 },
  shipping: { settlement: "ship" },
  siegeDamage: { troop: "heavy" },
  soldierStrength: { troop: "shield" },
  storageCapacity: { building: 29 },
  towerArcherDamage: { troop: "archer" },
  tradeOfferSlot: { ware: "coins" },
  treeGrowth: { building: 20 }
};

export interface TalentIcon {
  /** Set for building thumbnails, so a nation change swaps them like every other building icon. */
  buildingType?: number;
  source: string;
}

const resolveIcon = (spec: TalentIconSpec, nation: string): TalentIcon => {
  if ("building" in spec)
    return { buildingType: spec.building, source: getSettlementBuildingIconSource(spec.building) ?? "" };
  if ("picture" in spec) return { source: spec.picture };
  if ("progression" in spec) return { source: progressionIcon(spec.progression) };
  if ("troop" in spec) return { source: troopIcon(nation, spec.troop) };
  if ("settlement" in spec) return { source: getSettlementIconSource(spec.settlement) };
  return { source: getWareIconSource(spec.ware) };
};

/** The talent's icon in the player's nation (troop portraits and buildings follow it). */
export const getTalentIcon = (id: string, nation: string): TalentIcon =>
  resolveIcon(TALENT_ICONS[id] ?? { progression: "level-star" }, nation);
