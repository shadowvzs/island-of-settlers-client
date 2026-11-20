import type { I18n } from "@lingui/core";

import type { CampaignNodeState } from "../../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type {
  CampaignRequirementLine, CampaignRequirementStatus
} from "../../../shared/campaign/campaign-requirements";
import { displayWareName, translateDomainText } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { joinClassNames, type SelectOption } from "../../components/helpers";
import { troopPortrait } from "../../settlement/army-icons";
import { campaignExitName, campaignRecordName } from "../../settlement/campaign-record-names";
import { troopPluralName } from "../../settlement/troop-names";
import { getWareIconSource } from "../inventory";
import type { SettlementUiSnapshot } from "../types";
import { CHIP_CLASS, FALLBACK_NATION, MAP_ROW_CLASS, STATUS_ICONS } from "./constants";
import { CAMPAIGN_WINDOW_MESSAGES as M } from "./messages";
import type { CampaignChoice, CampaignMapChoice } from "./types";

/** What the window reads from the settlement snapshot: the nation of the soldier portraits. */
export const selectCampaignNation = (snapshot: SettlementUiSnapshot) => snapshot.playerNation ?? FALLBACK_NATION;

/** The campaign shown: the chosen one while it is still offered, else the first. */
export const currentCampaign = (choices: readonly CampaignChoice[], campaignId: string | null) =>
  choices.find(choice => choice.campaign.id === campaignId) ?? choices[0];

/** The map shown: the chosen one, else the first map that can start, else the first map. */
export const currentMap = (choice: CampaignChoice | undefined, mapId: string | null) =>
  choice?.maps.find(entry => entry.map.id === mapId) ??
  choice?.maps.find(entry => entry.status !== "notAvailable") ?? choice?.maps[0];

export const campaignOptions = (choices: readonly CampaignChoice[], i18n?: I18n): SelectOption<string>[] =>
  choices.map(({ campaign }) => ({
    label: campaignRecordName(campaign, i18n),
    value: campaign.id
  }));

export interface CampaignMapRow {
  className: string;
  /** Second line: "Won: <exit>" on a map completed through a named exit, the reason on a closed one, else empty. */
  detail: string;
  /** Named HUD icon of the state: the tick of a completed map, a cross on a closed one, else the standard. */
  icon: string;
  id: string;
  name: string;
  /** Display state (BR4); `closed` and `notAvailable` rows read dimmed with their names (owner Q3). */
  node: CampaignNodeState;
  selected: boolean;
  /** Tooltip and accessible description of the state. */
  statusText: string;
}

const rowDetail = ({ exit, map, node }: CampaignMapChoice, i18n?: I18n) => {
  if (node === "closed") return translateMessage(i18n, M.status.closed);
  if (node !== "completed" || !exit) return "";
  const name = campaignExitName(map, exit, i18n);
  return name ? translateMessage(i18n, M.won, { exit: name }) : "";
};

/** A completed map's status names the replay reward only while rewards are on (plan §9.3). */
const statusMessage = (node: CampaignNodeState, rewardsShown: boolean) =>
  (node === "completed" && !rewardsShown ? M.completedUnrewarded : M.status[node]);

interface MapRowContext {
  i18n?: I18n;
  rewardsShown: boolean;
  selectedId: string | undefined;
}

const mapRow = (choice: CampaignMapChoice, index: number, { i18n, rewardsShown, selectedId }: MapRowContext) => {
  const { map, node } = choice, selected = map.id === selectedId;
  return {
    className: joinClassNames(MAP_ROW_CLASS, `${MAP_ROW_CLASS}--${node}`, selected && `${MAP_ROW_CLASS}--selected`),
    detail: rowDetail(choice, i18n),
    icon: STATUS_ICONS[node],
    id: map.id,
    name: translateMessage(i18n, M.mapName, { name: campaignRecordName(map, i18n), order: index + 1 }),
    node,
    selected,
    statusText: translateMessage(i18n, statusMessage(node, rewardsShown))
  } satisfies CampaignMapRow;
};

/** The campaign's maps in graph order with their state, numbered in that order. */
export const campaignMapRows = (choice: CampaignChoice | undefined, selectedId: string | undefined, i18n?: I18n) => {
  const context = { i18n, rewardsShown: choice?.rewardsShown ?? true, selectedId };
  return (choice?.maps ?? []).map((entry, index) => mapRow(entry, index, context));
};

export interface CampaignCargoChip {
  amount: string;
  className: string;
  /** Picture of the ware or soldier; absent for the settlers chip, which uses the named HUD icon. */
  image?: string;
  key: string;
  title: string;
}

const lineName = ({ item, kind }: CampaignRequirementLine, nation: string, i18n?: I18n) => {
  if (kind === "goods") return displayWareName(item, i18n);
  if (kind === "soldiers") return troopPluralName(nation, item as MilitaryTroopType, i18n);
  return translateMessage(i18n, M.settlers);
};

const lineImage = ({ item, kind }: CampaignRequirementLine, nation: string) => {
  if (kind === "goods") return getWareIconSource(item);
  if (kind === "soldiers") return troopPortrait(nation, item as MilitaryTroopType);
  return undefined;
};

const cargoChip = (line: CampaignRequirementLine, nation: string, i18n?: I18n): CampaignCargoChip => ({
  amount: `${Math.min(line.available, line.required)}/${line.required}`,
  className: line.missing > 0 ? `${CHIP_CLASS} ${CHIP_CLASS}--missing` : CHIP_CLASS,
  image: lineImage(line, nation),
  key: `${line.kind}:${line.item}`,
  title: translateMessage(i18n, M.chip,
    { available: line.available, name: lineName(line, nation, i18n), required: line.required })
});

/** One chip per cargo line (soldiers, wares, settlers): what leaves home storage and what is still missing. */
export const campaignCargoChips = (status: CampaignRequirementStatus, nation: string, i18n?: I18n) =>
  status.lines.map(line => cargoChip(line, nation, i18n));

export interface CampaignDepartModel {
  chips: CampaignCargoChip[];
  disabled: boolean;
  /** Why the map cannot start now, else the ready line. */
  hint: string;
  /** Tooltip of the ships chip. */
  ships: string;
  /** "idle/needed". */
  shipsAmount: string;
  shipsClassName: string;
}

const isLocked = (node: CampaignNodeState) => node === "notAvailable" || node === "closed";

const hintOf = (node: CampaignNodeState, status: CampaignRequirementStatus, i18n?: I18n) => {
  if (isLocked(node)) return translateMessage(i18n, M.status[node]);
  if (status.reason) return translateDomainText(status.reason, i18n);
  return translateMessage(i18n, status.lines.length ? M.ready : M.noCargo);
};

/**
 * The selected map's departure panel: cargo chips, ships and whether Set sail is offered (never on a locked map or
 * a closed branch, whose hint says why).
 */
export const campaignDepartModel = (
  node: CampaignNodeState, status: CampaignRequirementStatus, nation: string, busy: boolean, i18n?: I18n
): CampaignDepartModel => ({
  chips: campaignCargoChips(status, nation, i18n),
  disabled: busy || isLocked(node) || status.reason !== null,
  hint: hintOf(node, status, i18n),
  ships: translateMessage(i18n, M.ships, { idle: status.idleShips, needed: status.shipsNeeded }),
  shipsAmount: `${status.idleShips}/${status.shipsNeeded}`,
  shipsClassName: status.idleShips > 0 ? CHIP_CLASS : `${CHIP_CLASS} ${CHIP_CLASS}--missing`
});

/** The status line after a departure attempt: the translated refusal, or nothing when the session said why. */
export const campaignStartStatus = (result: true | string, i18n?: I18n) =>
  result === true ? "" : translateDomainText(result, i18n);
