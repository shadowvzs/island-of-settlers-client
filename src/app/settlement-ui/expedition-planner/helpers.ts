import type { I18n } from "@lingui/core";

import { COLONY_DIFFICULTIES, COLONY_SUPPLIES } from "../../../shared/balance/colonies";
import { translateDomainText } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import { talentModifiers } from "../../../shared/progression/talents";
import { type AdventureIsland, isAdventureIsland } from "../../../shared/settlement/adventure-rules";
import {
  COLONY_TROOP_TYPES, type ColonyDifficulty, type ColonyIsland, colonyTroopCount, type ColonyTroops
} from "../../../shared/settlement/colony-expedition-rules";
import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import type { ColonyExpeditionPlan } from "../../../shared/settlement/settlement-colony-expeditions";
import type { CommanderSnapshot } from "../../../shared/settlement/settlement-commander";
import { shipTravelSeconds } from "../../../shared/settlement/ship-travel-time";
import { wareDisplayName } from "../../../shared/settlement/ware-names";
import { colonyResourcePair } from "../../../shared/world/colony-resource-tiers";
import { joinDetails } from "../../components/helpers";
import type { TooltipLine } from "../../components/info-tooltip-helpers";
import { commanderPortrait, troopPortrait } from "../../settlement/army-icons";
import { troopPluralName } from "../../settlement/troop-names";
import { type ArtImage, settlementIconArt } from "../art-helpers";
import {
  commanderAuraText, commanderLoadoutText, commanderRoleText, commanderStyleText
} from "../building-details/commander-helpers";
import {
  adventureThreatSummary, clampColonyTroop, colonyDifficultySummary, formatColonyDuration,
  getColonyDifficultyName, getColonyOreName
} from "../colony-helpers";
import { islandClimateLabel, islandClimateTooltip } from "../island-climate-label";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiOptions, SettlementUiSnapshot } from "../types";

export const EMPTY_TROOPS: ColonyTroops = { archer: 0, cavalry: 0, heavy: 0, shield: 0 };
export const getExpeditionOngoingMessage = (i18n?: I18n) => translateMessage(i18n, M.planner.ongoing);
export const getAdventureBusyMessage = (i18n?: I18n) => translateMessage(i18n, M.planner.adventureBusy);
const getStartRefused = (i18n?: I18n) => translateMessage(i18n, M.planner.startRefused);
const getColonyCrew = (i18n?: I18n) => translateMessage(i18n, M.planner.crew);

export type PlannerKind = "adventure" | "colony";
type ColonyIslandChoice = ColonyIsland & { taken: boolean };
export type PlannerIsland = AdventureIsland | ColonyIslandChoice;

/** One island card: its picture and one detail line (or why it cannot be chosen). */
export interface PlannerIslandCard { art: ArtImage; detail: string; tooltip?: string }

/** What the planner reads from the settlement snapshot. */
export interface PlannerSlice {
  available: Readonly<Partial<ColonyTroops>>;
  blocked: string | null;
  /** The player's one commander, if this home island has it. */
  commanders: readonly CommanderSnapshot[];
  islands: readonly PlannerIsland[];
  nation: string;
  /** Voyage time reductions of the player's talents: Shipping (colonies) and adventure sailing. */
  sailing: { adventure: number; colony: number };
}
const NO_SAILING_TALENT: PlannerSlice["sailing"] = Object.freeze({ adventure: 0, colony: 0 });
/** One cached object per talent set, so the shallow-compared slice stays stable between snapshots. */
const sailingCache = new WeakMap<object, PlannerSlice["sailing"]>();
const sailingOf = (snapshot: SettlementUiSnapshot) => {
  const ranks = snapshot.player?.talents;
  if (!ranks) return NO_SAILING_TALENT;
  let sailing = sailingCache.get(ranks);
  if (!sailing) {
    const talents = talentModifiers(ranks);
    sailing = { adventure: talents.adventureSailingReduction, colony: talents.shippingTimeReduction };
    sailingCache.set(ranks, sailing);
  }
  return sailing;
};

/** The sail time the fleet will take, with the voyage's talent (Shipping for colonies, adventure sailing). */
const sailLabel = (voyageSeconds: number, reduction: number, i18n?: I18n) => {
  const time = formatColonyDuration(shipTravelSeconds(voyageSeconds, reduction), i18n);
  return reduction > 0
    ? translateMessage(i18n, M.planner.sailTalent, { percent: Math.round(reduction * 100), time })
    : translateMessage(i18n, M.planner.sail, { time });
};

const resourceTierLabel = (tier: ColonyIsland["resourceTier"], i18n?: I18n) => {
  if (!tier) return undefined;
  const pair = colonyResourcePair(tier);
  return translateMessage(i18n, M.planner.tier, {
    stone: wareDisplayName(pair.stone), tier, wood: wareDisplayName(pair.wood)
  });
};

/** Colony cards: single ore type and one-way voyage; claimed islands stay disabled. */
const colonyIslandCard = (
  island: ColonyIslandChoice, reduction: number, i18n?: I18n
): PlannerIslandCard => ({
  art: settlementIconArt(`island-${island.theme ?? "forest"}`),
  detail: island.taken
    ? translateMessage(i18n, M.planner.claimed)
    : joinDetails(getColonyOreName(island.ore, i18n), resourceTierLabel(island.resourceTier, i18n),
      islandClimateLabel(island, i18n), sailLabel(island.voyageSeconds, reduction, i18n)),
  tooltip: islandClimateTooltip(island, i18n)
});

/** Adventure cards: the committed climate illustration, map size and voyage (no colony wares). */
const adventureIslandCard = (
  island: AdventureIsland, reduction: number, i18n?: I18n
): PlannerIslandCard => ({
  art: settlementIconArt(`island-${island.theme ?? "forest"}`),
  detail: joinDetails(islandClimateLabel(island, i18n), `${island.size}×${island.size} map`,
    sailLabel(island.voyageSeconds, reduction, i18n)),
  tooltip: islandClimateTooltip(island, i18n)
});

const isTaken = (island: PlannerIsland) => "taken" in island && island.taken;

const islandCard = (
  island: PlannerIsland, sailing: PlannerSlice["sailing"], i18n?: I18n
) => isAdventureIsland(island)
  ? adventureIslandCard(island, sailing.adventure, i18n)
  : colonyIslandCard(island, sailing.colony, i18n);

/** Island radio cards: name, difficulty badge and the card's detail; taken islands stay disabled. */
export const getIslandCards = (
  islands: readonly PlannerIsland[], selected: number | null, _nation: string,
  sailing: PlannerSlice["sailing"] = NO_SAILING_TALENT, i18n?: I18n
) =>
  islands.map(island => {
    const { art, detail, tooltip } = islandCard(island, sailing, i18n);
    const level = getColonyDifficultyName(island.difficulty, i18n);
    const title = tooltip
      ? translateMessage(i18n, M.planner.islandTitleTooltip, { detail, level, name: island.name, tooltip })
      : translateMessage(i18n, M.planner.islandTitle, { detail, level, name: island.name });
    const resources: string[] = [];
    if (!isAdventureIsland(island)) {
      if (island.resourceTier) {
        const pair = colonyResourcePair(island.resourceTier);
        resources.push(`${pair.wood}Logs`, pair.stone);
      } else resources.push("logs", "stone");
    }
    const resourceIcons = resources.map(ware => ({ title: wareDisplayName(ware), ware }));
    return {
      art, checked: island.id === selected, detail, disabled: isTaken(island), id: island.id, level,
      climate: island.theme ?? "forest",
      difficultyNumber: { easy: 1, medium: 2, hard: 3 }[island.difficulty],
      levelClassName: `colony-planner__level colony-planner__level--${island.difficulty}`,
      name: island.name,
      resources: resourceIcons,
      title,
      tooltipLines: [{ marked: true, text: island.name }, { text: level }, { text: detail },
        ...[tooltip, resourceIcons.map(resource => resource.title).join(" · ")]
          .filter(Boolean).map(text => ({ text: text! }))]
    };
  });

export type PlannerIslandCardView = ReturnType<typeof getIslandCards>[number];

/** The chosen island while it is still offered and free, else the first free one. */
export const resolvePlannerIsland = (islands: readonly PlannerIsland[], chosen: number | null) => {
  if (islands.some(entry => entry.id === chosen && !isTaken(entry))) return chosen;
  return islands.find(entry => !isTaken(entry))?.id ?? null;
};

const operationBlocked = (snapshot: SettlementUiSnapshot, i18n?: I18n) =>
  snapshot.operationBlock ? translateDomainText(snapshot.operationBlock, i18n) : null;

const colonyBlocked = (snapshot: SettlementUiSnapshot, i18n?: I18n) =>
  snapshot.expeditionOngoing ? getExpeditionOngoingMessage(i18n) : operationBlocked(snapshot, i18n);

const adventureBlocked = (snapshot: SettlementUiSnapshot, i18n?: I18n) => {
  if (snapshot.expeditionOngoing) return getExpeditionOngoingMessage(i18n);
  const abroad = (snapshot.colonyExpeditions ?? []).some(expedition => isAdventureIsland(expedition.island));
  if (abroad || snapshot.adventures?.length) return getAdventureBusyMessage(i18n);
  return operationBlocked(snapshot, i18n);
};

/** The planner's slice of the snapshot (shallow-compared): stored troops, offered islands, why blocked. */
export const selectPlanner = (kind: PlannerKind, source?: number, i18n?: I18n) =>
  (snapshot: SettlementUiSnapshot): PlannerSlice => ({
  available: snapshot.colonyTroopsByHarbour?.[source ?? -1] ?? snapshot.colonyTroops ?? {},
  blocked: kind === "colony" ? colonyBlocked(snapshot, i18n) : adventureBlocked(snapshot, i18n),
  commanders: snapshot.commanders ?? [],
  islands: (kind === "colony" ? snapshot.colonyIslands : snapshot.adventureIslands) ?? [],
  nation: snapshot.playerNation ?? "roman",
  sailing: sailingOf(snapshot)
});

/** Threat line under the island cards. */
export const getThreatLabel = (island: PlannerIsland | undefined, i18n?: I18n) => {
  if (!island) return "";
  if (isAdventureIsland(island)) return adventureThreatSummary(island, i18n);
  return translateMessage(i18n, M.planner.threatColony, {
    difficulty: getColonyDifficultyName(island.difficulty, i18n),
    summary: colonyDifficultySummary(island.difficulty, i18n)
  });
};

/** One `NumberStepper` row per troop type: portrait, name, stored count and the amount to send. */
export const getTroopRows = (
  troops: Readonly<ColonyTroops>, available: Readonly<Partial<ColonyTroops>>, nation: string, i18n?: I18n
) => COLONY_TROOP_TYPES.map(type => {
  const name = troopPluralName(nation, type);
  const stored = available[type] ?? 0;
  return {
    decreaseLabel: translateMessage(i18n, M.planner.fewer, { troop: name.toLowerCase() }),
    icon: troopPortrait(nation, type),
    increaseLabel: translateMessage(i18n, M.planner.more, { troop: name.toLowerCase() }),
    label: translateMessage(i18n, M.planner.toSend, { troop: name }),
    max: stored, name, stored: translateMessage(i18n, M.planner.stored, { count: stored }),
    type, value: troops[type]
  };
});

export type PlannerTroopRow = ReturnType<typeof getTroopRows>[number];

export interface PlannerCommanderCard {
  aria: string;
  checked: boolean;
  detail: string;
  disabled: boolean;
  hp: string;
  id: string;
  level: string;
  name: string;
  portrait?: string;
  rank?: number;
  status: string;
  title: string;
  tooltipLines: readonly TooltipLine[];
}

const commanderStatusText = (commander: CommanderSnapshot, i18n?: I18n) => {
  const { blockReason } = commander;
  if (blockReason === "awaiting-evacuation")
    return translateMessage(i18n, M.planner.commanderAwaitingEvacuation);
  if (blockReason === "awaiting-home" || blockReason === "missing-home")
    return translateMessage(i18n, M.planner.commanderAwaitingHome);
  if (blockReason === "incapacitated")
    return translateMessage(i18n, M.planner.commanderIncapacitated);
  if (blockReason === "assigned")
    return translateMessage(i18n, M.planner.commanderAssigned);
  if (blockReason === "away")
    return translateMessage(i18n, M.planner.commanderAway);
  if (blockReason === "recovering")
    return translateMessage(i18n, M.planner.commanderRecovering, {
      minutes: String(Math.ceil(commander.recoverySeconds / 60))
    });
  if (blockReason === "too-injured")
    return translateMessage(i18n, M.planner.commanderTooInjured, {
      current: String(Math.ceil(commander.hp)), maximum: String(Math.ceil(commander.maximumHp)),
      required: String(Math.ceil(commander.maximumHp * .5))
    });
  return translateMessage(i18n, M.planner.commanderReady);
};

/** One optional commander card per owned commander, plus the always-present `No commander` card. */
export const getCommanderCards = (
  commanders: readonly CommanderSnapshot[], selected: string | null | undefined, i18n?: I18n
): PlannerCommanderCard[] => [
  {
    aria: translateMessage(i18n, M.planner.noCommander),
    checked: !selected,
    detail: "",
    disabled: false,
    hp: "",
    id: "",
    level: "",
    name: translateMessage(i18n, M.planner.noCommander),
    status: "",
    title: translateMessage(i18n, M.planner.noCommander),
    tooltipLines: [{ text: translateMessage(i18n, M.planner.noCommander) }]
  },
  ...commanders.map(commander => {
    const status = commanderStatusText(commander, i18n);
    const hp = translateMessage(i18n, M.planner.commanderHp, {
      current: String(Math.ceil(commander.hp)), maximum: String(Math.ceil(commander.maximumHp))
    });
    const role = `${commanderRoleText(commander, i18n)} · ${commanderStyleText(commander, i18n)} · ` +
      commanderLoadoutText(commander, i18n);
    const level = translateMessage(i18n, M.planner.commanderLevel, { level: String(commander.level) });
    const aura = commanderAuraText(commander, i18n), deck = translateMessage(i18n, M.planner.commanderDeck);
    const detail = `${role} · ${hp} · ${aura}`;
    const title = `${hp} · ${status} · ${deck}`;
    return {
      aria: translateMessage(i18n, M.planner.commanderCardTitle, {
        hp, name: commander.name, role, status
      }),
      checked: selected === commander.id,
      detail,
      disabled: !commander.ready,
      hp,
      id: commander.id,
      level,
      name: commander.name,
      portrait: commanderPortrait(commander.definition.icon),
      rank: commander.level,
      status,
      title,
      tooltipLines: [{ marked: true, text: commander.name }, ...[level, role, hp, aura, status, deck].map(text => ({ text }))]
    };
  })
];

export const getCommanderSummary = (commander: CommanderSnapshot | undefined, i18n?: I18n) =>
  commander
    ? translateMessage(i18n, M.planner.commanderSelection, { name: commander.name })
    : translateMessage(i18n, M.planner.commanderNoneSelected);

export const findSelectedCommander = (commanders: readonly CommanderSnapshot[], selected: string | null | undefined) =>
  selected ? commanders.find(commander => commander.id === selected) : undefined;

/** Selection stays a draft; an invalid card is retained with its reason instead of silently replaced. */
export const commanderLaunchReason = (
  commanders: readonly CommanderSnapshot[], selected: string | null | undefined, i18n?: I18n
) => {
  if (!selected) return null;
  const commander = findSelectedCommander(commanders, selected);
  if (!commander) return translateMessage(i18n, M.planner.commanderAssigned);
  return commander.ready ? null : commanderStatusText(commander, i18n);
};

/** A new draft with one troop type changed, clamped to its stock and the difficulty's capacity. */
export const setPlannerTroop = (
  troops: Readonly<ColonyTroops>, type: MilitaryTroopType, wanted: number,
  difficulty: ColonyDifficulty, available: Readonly<Partial<ColonyTroops>>
): ColonyTroops => ({ ...troops, [type]: clampColonyTroop(troops, type, wanted, difficulty, available) });

export const getTotalLabel = (
  troops: Readonly<ColonyTroops>, difficulty: ColonyDifficulty, i18n?: I18n
) => translateMessage(i18n, M.planner.troopsTotal, {
  cap: COLONY_DIFFICULTIES[difficulty].troopCap, count: colonyTroopCount(troops)
});

export const getEstimateLabel = (plan: ColonyExpeditionPlan | undefined, i18n?: I18n) => {
  if (!plan?.ships) return translateMessage(i18n, M.planner.noShip);
  return translateMessage(i18n, M.planner.estimate, {
    arrival: formatColonyDuration(plan.seconds, i18n),
    loads: plan.loads, ships: plan.ships, trips: plan.trips
  });
};

/** Start needs troops, a ship, an island, a ready commander choice and no other expedition under way. */
export const canStartExpedition = (
  troops: Readonly<ColonyTroops>, plan: ColonyExpeditionPlan | undefined, island: number | null,
  blocked: string | null, commanderReason: string | null = null
) => colonyTroopCount(troops) >= (plan?.requiredSoldiers ?? 1) && !plan?.launchReason &&
  Boolean(plan?.ships) && island !== null && !blocked && !commanderReason && !plan?.commanderReason;

type PlannerOptions = Pick<SettlementUiOptions,
  "onAdventureReward" | "onPlanAdventure" | "onPlanColony" | "onStartAdventure" | "onStartColony">;

/** The synchronous plan (ships, loads, trips, arrival) for the current choice. */
export const planExpedition = (
  kind: PlannerKind, options: PlannerOptions, harbour: number, island: number | null,
  troops: Readonly<ColonyTroops>, commanderId?: string
) => {
  if (island === null) return undefined;
  if (kind === "colony") return commanderId
    ? options.onPlanColony?.(harbour, island, troops, commanderId)
    : options.onPlanColony?.(harbour, island, troops);
  return commanderId
    ? options.onPlanAdventure?.(harbour, island, troops, commanderId)
    : options.onPlanAdventure?.(harbour, island, troops);
};

/** Starts the expedition: true, or the reason it cannot start. */
export const startExpedition = (
  kind: PlannerKind, options: PlannerOptions, harbour: number, island: number,
  troops: Readonly<ColonyTroops>, commanderId?: string, i18n?: I18n
): true | string => {
  const start = kind === "colony" ? options.onStartColony : options.onStartAdventure;
  return (commanderId
    ? start?.(harbour, island, { ...troops }, commanderId)
    : start?.(harbour, island, { ...troops })) ?? getStartRefused(i18n);
};

/** Colony: supplies and crew; adventure: the reward preview at the player's level (troops only). */
export const getPlannerDetails = (
  kind: PlannerKind, options: PlannerOptions, island: PlannerIsland | undefined, i18n?: I18n
) => {
  if (kind === "colony") return { crew: getColonyCrew(i18n), kind, supplies: COLONY_SUPPLIES } as const;
  const reward = island && isAdventureIsland(island) ? options.onAdventureReward?.(island) : undefined;
  if (!reward) return { kind } as const;
  return {
    kind,
    reward: {
      experience: translateMessage(i18n, M.planner.reward, {
        count: Math.round(reward.perLevel), experience: reward.experience
      }),
      goods: reward.goods
    }
  } as const;
};

export type PlannerDetails = ReturnType<typeof getPlannerDetails>;
