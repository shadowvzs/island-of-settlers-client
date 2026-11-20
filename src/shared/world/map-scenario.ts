import type { BanditSiteRef } from "../../render-common/buildings/bandit-camp-plan";
import { WARE_IDS } from "../../render-common/wares/ware-catalog";
import { isWorkerNation } from "../../render-common/workers/worker-appearance";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { START_SETTLERS } from "../balance/population";
import { isOrdinaryTroopType, type MilitaryTroopType } from "../settlement/military-combat-rules";
import type { RoadSegment } from "../settlement/road-types";
import { isSaveObject } from "../settlement/save-validation";
import { MAX_SCENARIO_BUILDINGS } from "./constants";
import { type MarbleDeposit,validMarbleDeposits } from "./marble-deposit";
import { type BuildingAvailability, validScenarioAvailability } from "./scenario-availability";
import { validScenarioBanditSite } from "./scenario-bandit-sites";
import { validScenarioCampaignRules } from "./scenario-campaign-rules";
import { type ScenarioCatapult, validScenarioCatapult } from "./scenario-catapult";
import { type ScenarioDecoration, validScenarioDecorations } from "./scenario-decorations";
import { activeFactionAi, type ScenarioFactionAi } from "./scenario-faction-ai";
import { validScenarioFactionAi } from "./scenario-faction-ai-issues";
import { type ScenarioGarrisonGroup,validScenarioGarrison } from "./scenario-garrison";
import { type MapRules, validScenarioMapRules } from "./scenario-map-rules";
import { validScenarioObjectIds } from "./scenario-object-ids";
import { validScenarioPatrols } from "./scenario-patrol";
import type { ScenarioPlayerSlot } from "./scenario-players";
import { validScenarioRoads } from "./scenario-roads";
import { type ScenarioStartTroop, validScenarioStartTroops } from "./scenario-start-troops";

export interface ScenarioPoint { x: number; z: number }
interface ScenarioHeadquarters extends ScenarioPoint { rotation: number }
export interface ScenarioUnit extends ScenarioPoint {
  /** Closed patrol through these points and spawn; free hostile field units only. */
  patrol?: ScenarioPoint[];
  id: number;
  faction: number;
  group: number;
  heading: number;
  rank: number;
  type: MilitaryTroopType;
}
export interface ScenarioBuilding extends ScenarioPoint {
  id: number;
  type: number;
  rotation: number;
  faction: number;
  defenders: number;
  /** Finite real soldiers; absent preserves historical shield-only defenders. */
  garrison?: ScenarioGarrisonGroup[];
  catapult?: ScenarioCatapult;
  /** A bandit site (`bandit:` code and layout); `type` is then its catalog military building. */
  bandit?: BanditSiteRef;
  enclosure?: "building";
}
/** Authored definitions; runtime actors and their combat state belong only to game saves. */
export interface MapScenario {
  version: 1;
  /**
   * `home` is a peaceful settlement start and never carries authored enemy units or camps. `campaign` is a
   * campaign map: never the home island (no gem shop, trade or market; island-role.ts).
   */
  kind: "home" | "adventure" | "colony" | "campaign";
  nation: WorkerNation;
  theme?: "tropical" | "forest" | "winter" | "desert" | "swamp";
  headquarters?: ScenarioHeadquarters;
  /** Initial public road graph. Game saves replace this graph with their runtime roads. */
  roads?: RoadSegment[];
  /** Authored decoration models (editor palette); validated with the game's decoration placement rules. */
  decorations?: ScenarioDecoration[];
  /**
   * Reservation only: never grants a completed harbour or stock. On a `campaign` map it is the landing harbour, the
   * player's start (review R4: no player HQ there); the run builds it there on a stored harbour spot (C9a).
   */
  harbourPlot?: ScenarioHeadquarters;
  /** Start wares of a fresh start; empty means the nation's catalog default (`scenario-start-stock.ts`). */
  stock: Record<string, number>;
  settlers: number;
  /** Player soldiers in the home building's reserve at a fresh start (GS-MAP); absent: none. */
  startTroops?: ScenarioStartTroop[];
  /**
   * Campaign maps only (owner Q5, 2026-11-12): "off" means a start without a home island takes nothing from this
   * file (no wares, settlers or soldiers; the map script provides). Absent: the stock, settlers and start soldiers
   * above are used. Expedition starts always bring their cargo instead.
   */
  startSetup?: "off";
  /**
   * Building availability on every map kind (owner 2026-11-17): highest tier 1..5, banned types and per-type
   * level caps; absent: nothing narrowed. A campaign record's blacklist narrows it further at runtime.
   */
  availability?: BuildingAvailability;
  /** The map's own narrowing overrides of the game settings (GS0 `MapRules`); absent: inherit everything. */
  rules?: MapRules;
  /**
   * The AI mode of computer factions (enemy economy AI plan §2.1); absent, or a faction without an entry: `none`,
   * the behaviour before the field existed. Never on a home map.
   */
  factionAi?: ScenarioFactionAi[];
  units: ScenarioUnit[];
  /** Explicit finite sources; absent preserves legacy colony generation. */
  marbleDeposits?: MarbleDeposit[];
  buildings: ScenarioBuilding[];
  landing?: ScenarioPoint;
  objective: "capture" | "defeat";
  rewardCoins: number;
  claimSeconds: number;
  expirySeconds: number;
  /**
   * Building unlocks on this island: the player's level (default) or every building at once, for
   * authored showcases and editor test-play (level progression plan, owner 2026-10-20).
   */
  buildingUnlocks?: "player-level" | "all";
  /*
   * The two runtime rule fields below come from the campaign map (`campaignScenarioRules`, applied by C9a); a map
   * file's own values are overridden, and the campaign validator warns about them (C7a).
   */
  /** Campaign maps only: building types the human player cannot build there (hidden from the menu, owner Q7). */
  disabledBuildings?: number[];
  /** Campaign maps only: the commander may join, so the Commander's Lodge is buildable there (review R11). */
  commanderAllowed?: boolean;
  /** Campaign maps only: one human slot (faction 0) and up to four others (plan item 42). */
  players?: ScenarioPlayerSlot[];
  /**
   * The never-decreasing map-file object id counter (ACT1, `scenario-object-ids.ts`): units, buildings and
   * decoration models share its id space. Absent on maps without authored objects; filled once on load.
   */
  nextObjectId?: number;
}
export const createMapScenario = (): MapScenario => ({
  version: 1, kind: "home", nation: "roman", theme: "forest", stock: {}, settlers: START_SETTLERS,
  units: [], buildings: [], objective: "capture", rewardCoins: 0, claimSeconds: 0, expirySeconds: 0
});
const integer = (value: unknown, min: number, max: number) =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const point = (value: unknown, width: number, height: number) => isSaveObject(value) &&
  typeof value.x === "number" && Number.isFinite(value.x) && value.x >= 0 && value.x < width &&
  typeof value.z === "number" && Number.isFinite(value.z) && value.z >= 0 && value.z < height;
/** Enemy building types a map may author for any hostile faction. */
const AUTHORED_ENEMY_TYPES: readonly number[] = [1, 2, 4, 9, 16];
/**
 * An authored enemy building's type: the hostile types, or the depot of a faction whose AI plays (mode other than
 * `none`): an enemy headquarters (type 0, owner Q-BD2) without defenders, which takes the faction's `start`.
 */
const validAuthoredType = (building: Record<string, unknown>, factionAi: unknown) => {
  if (AUTHORED_ENEMY_TYPES.includes(building.type as number)) return true;
  return building.type === 0 && building.defenders === 0 &&
    activeFactionAi(factionAi as ScenarioFactionAi[] | undefined).some(entry => entry.faction === building.faction);
};
export const isMapScenario = (value: unknown, width: number, height: number): value is MapScenario => {
  if (!isSaveObject(value) || value.version !== 1 || !["home", "adventure", "colony", "campaign"].includes(String(value.kind)) ||
    !isWorkerNation(value.nation) ||
    !integer(value.settlers, 0, 10000) || !isSaveObject(value.stock) || Object.keys(value.stock).length > 100 ||
    !Object.entries(value.stock).every(([key, amount]) => (WARE_IDS as readonly string[]).includes(key) && integer(amount, 0, 100000)) ||
    !["capture", "defeat"].includes(String(value.objective)) || !integer(value.rewardCoins, 0, 100000) ||
    !integer(value.claimSeconds, 0, 31536000) || !integer(value.expirySeconds, 0, 31536000)) return false;
  if (value.buildingUnlocks !== undefined && value.buildingUnlocks !== "player-level" && value.buildingUnlocks !== "all")
    return false;
  if (!validScenarioCampaignRules(value) || !validScenarioAvailability(value.availability)) return false;
  if (!validScenarioMapRules(value) || !validScenarioStartTroops(value.startTroops)) return false;
  if (value.startSetup !== undefined && (value.startSetup !== "off" || value.kind !== "campaign")) return false;
  if (!validScenarioFactionAi({ factionAi: value.factionAi, kind: value.kind })) return false;
  if (!validMarbleDeposits(value.marbleDeposits, width, height)) return false;
  if (!validScenarioRoads(value.roads, width, height)) return false;
  if (!validScenarioDecorations(value.decorations, width, height)) return false;
  if (value.harbourPlot !== undefined && (!point(value.harbourPlot, width, height) ||
    !isSaveObject(value.harbourPlot) || !integer(value.harbourPlot.rotation, 0, 3))) return false;
  if (value.theme !== undefined && (typeof value.theme !== "string" || !["tropical", "forest", "winter", "desert", "swamp"].includes(value.theme))) return false;
  if (value.headquarters !== undefined && (!point(value.headquarters, width, height) ||
    !isSaveObject(value.headquarters) || !integer(value.headquarters.rotation, 0, 3))) return false;
  if (value.landing !== undefined && !point(value.landing, width, height)) return false;
  if (!Array.isArray(value.units) || !Array.isArray(value.buildings) ||
    value.units.length > 512 || value.buildings.length > MAX_SCENARIO_BUILDINGS) return false;
  for (const entry of [...value.units, ...value.buildings]) {
    if (!isSaveObject(entry) || !point(entry, width, height) || !integer(entry.faction, 1, 16)) return false;
  }
  if (!validScenarioObjectIds(value as unknown as MapScenario)) return false;
  // A home definition is a peaceful start: Play never spawns these objects for it.
  if (value.kind === "home" && (value.units.length || value.buildings.length)) return false;
  if (!validScenarioPatrols(value.units as unknown as ScenarioUnit[], width, height)) return false;
  // Authored ordinary cavalry is retired (HORSE-RETIREMENT-01): reject it explicitly rather than
  // silently spawning mounted enemies from an old or hand-edited scenario definition.
  return value.units.every(unit => isSaveObject(unit) && isOrdinaryTroopType(unit.type) &&
    integer(unit.rank, 0, 2) && integer(unit.group, 0, 1000) &&
    typeof unit.heading === "number" && Number.isFinite(unit.heading)) &&
    value.buildings.every(building => isSaveObject(building) && validAuthoredType(building, value.factionAi) &&
      integer(building.rotation, 0, 3) && integer(building.defenders, 0, 12) &&
      building.model === undefined && validScenarioBanditSite(building) &&
      validScenarioCatapult(building as unknown as ScenarioBuilding) &&
      validScenarioGarrison(building as unknown as ScenarioBuilding));
};
