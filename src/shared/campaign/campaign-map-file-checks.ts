import { adventurePoints } from "@shared/catalog/balance";

import { CAMPAIGN_MIN_TROOP_POINT_SHARE } from "../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import {
  type CampaignIssue, campaignIssue
} from "../../../../island-of-settlers-shared/src/campaign/campaign-issues";
import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  campaignScenarioRules
} from "../../../../island-of-settlers-shared/src/campaign/campaign-scenario-rules";
import { difficultyProfile } from "../settlement/difficulty";
import { harbourSpotAt } from "../settlement/harbour-spot-index";
import type { MapScenario } from "../world/map-scenario";
import { activeFactionAi } from "../world/scenario-faction-ai";
import { scenarioGarrison } from "../world/scenario-garrison";
import { HUMAN_FACTION, type ScenarioPlayerSlot } from "../world/scenario-players";
import type { WorldData } from "../world/world-data";
import { TROOP_POINT_PRECISION } from "./constants";

/** A campaign map file: the scenario already passed `isMapScenario` and has `kind: "campaign"`. */
export interface CampaignMapFile {
  scenario: MapScenario;
  world: Pick<WorldData, "playableIslands">;
}

const round = (value: number) => Math.round(value * TROOP_POINT_PRECISION) / TROOP_POINT_PRECISION;

/** R4: no player HQ; the player starts at the landing harbour, which stands on a stored harbour spot. */
export const checkLandingHarbour = ({ scenario, world }: CampaignMapFile, issues: CampaignIssue[]) => {
  if (scenario.headquarters) issues.push(campaignIssue("error", "playerHeadquartersOnCampaign", "headquarters"));
  const plot = scenario.harbourPlot;
  if (!plot) { issues.push(campaignIssue("error", "landingHarbourMissing", "harbourPlot")); return; }
  if (!harbourSpotAt(world, plot.x, plot.z, plot.rotation))
    issues.push(campaignIssue("error", "landingHarbourNotOnSpot", "harbourPlot"));
};

/** Factions that own units or buildings, or that an AI plays (it may start from its depot alone). */
const usedEnemyFactions = ({ buildings, factionAi, units }: MapScenario) =>
  [...new Set([...units, ...buildings, ...activeFactionAi(factionAi)].map(entry => entry.faction))]
    .sort((a, b) => a - b);

/** Without authored slots: the human plus one bandit slot per enemy faction, each its own team. */
const playerSlots = (scenario: MapScenario): readonly ScenarioPlayerSlot[] => scenario.players ?? [
  { faction: HUMAN_FACTION, kind: "human", team: HUMAN_FACTION },
  ...usedEnemyFactions(scenario).map(faction => ({ faction, kind: "bandits" as const, team: faction }))
];

/**
 * R6: until a teams lane exists every other faction is hostile (`isEnemyOf`), so a campaign map has exactly one
 * human slot (faction 0), no slot on the human's team and one hostile faction at most; every enemy faction that
 * owns units or buildings has a slot.
 */
export const checkPlayerSlots = ({ scenario }: CampaignMapFile, issues: CampaignIssue[]) => {
  const slots = playerSlots(scenario), humans = slots.filter(slot => slot.kind === "human");
  const human = humans[0];
  if (humans.length !== 1 || human?.faction !== HUMAN_FACTION)
    issues.push(campaignIssue("error", "invalidHumanSlot", "players"));
  const humanTeam = human?.team ?? HUMAN_FACTION, others = slots.filter(slot => slot.kind !== "human");
  for (const slot of others.filter(other => other.team === humanTeam))
    issues.push(campaignIssue("error", "alliedSlotUnsupported", "players", { faction: slot.faction }));
  const slotFactions = new Set(slots.map(slot => slot.faction)), used = usedEnemyFactions(scenario);
  for (const faction of used.filter(entry => !slotFactions.has(entry)))
    issues.push(campaignIssue("error", "factionWithoutSlot", "players", { faction }));
  const hostile = new Set([...others.filter(slot => slot.team !== humanTeam).map(slot => slot.faction), ...used]);
  if (hostile.size > 1) issues.push(campaignIssue("error", "multipleHostileFactions", "players",
    { count: hostile.size }));
};

const garrisonSoldiers = (scenario: MapScenario) => scenario.buildings.flatMap(entry =>
  scenarioGarrison(entry).flatMap(group => Array.from({ length: group.count }, () => ({ rank: group.rank }))));

/** Every enemy soldier of the map file at Normal: field units and garrisons, by rank. */
const enemySoldiers = (scenario: MapScenario) =>
  [...scenario.units.map(unit => ({ rank: unit.rank })), ...garrisonSoldiers(scenario)];

/** Whether the map file holds what the victory rule must defeat (item 38); other rules need no enemy target. */
const hasVictoryTarget = (map: CampaignMap, scenario: MapScenario) => {
  const { kind } = map.victory;
  // Authored scenario buildings are camps and forts; an enemy HQ (type 0) needs BD1 (review R5).
  if (kind === "destroyHeadquarters") return scenario.buildings.some(entry => entry.type === 0);
  if (kind === "eliminateArmy") return enemySoldiers(scenario).length > 0;
  if (kind === "totalVictory") return scenario.units.length > 0 || scenario.buildings.length > 0;
  return true;
};

export const checkVictoryTarget = (map: CampaignMap, { scenario }: CampaignMapFile, issues: CampaignIssue[]) => {
  if (!hasVictoryTarget(map, scenario))
    issues.push(campaignIssue("error", "victoryTargetMissing", "victory", { rule: map.victory.kind }));
};

/**
 * Item 38 advisory: the required soldiers (rank 0, adventure point weights) against the enemy force points of the
 * map file at the map's difficulty (the soldier multiplier, an estimate of the scaled roster).
 */
export const checkTroopPoints = (map: CampaignMap, { scenario }: CampaignMapFile, issues: CampaignIssue[]) => {
  const enemy = adventurePoints({ units: enemySoldiers(scenario) }) * difficultyProfile(map.difficulty).soldiers;
  const shipped = map.requiredCargo.soldiers.reduce((sum, line) => sum + line.amount, 0);
  const required = adventurePoints({ units: Array.from({ length: shipped }, () => ({ rank: 0 })) });
  if (enemy > 0 && required < enemy * CAMPAIGN_MIN_TROOP_POINT_SHARE)
    issues.push(campaignIssue("warning", "troopPointsLow", "requiredCargo.soldiers",
      { enemy: round(enemy), required: round(required) }));
};

const sameIds = (first: readonly number[], second: readonly number[]) =>
  first.length === second.length && first.every((id, index) => id === second[index]);

/** The run applies `campaignScenarioRules` over the map file, so differing map-file values are ignored (C7a). */
export const checkIgnoredRules = (map: CampaignMap, { scenario }: CampaignMapFile, issues: CampaignIssue[]) => {
  const rules = campaignScenarioRules(map);
  const banDiffers = scenario.disabledBuildings !== undefined &&
    !sameIds(scenario.disabledBuildings, rules.disabledBuildings);
  const commanderDiffers = scenario.commanderAllowed !== undefined &&
    scenario.commanderAllowed !== rules.commanderAllowed;
  if (banDiffers || commanderDiffers) issues.push(campaignIssue("warning", "mapFileRulesIgnored", "mapFile"));
};
