import type { CampaignAttemptEnd } from "../../../../island-of-settlers-shared/src/campaign/campaign-attempts";
import type { CampaignSoldierAmount } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { Archipelago } from "../settlement/archipelago";
import type { EmigratedTroop } from "../settlement/settlement-military";
import type { Goods } from "../settlement/settlement-types";
import type { CampaignOutcomeRecord } from "./campaign-map-outcome";
import type { CampaignRunState, CampaignRunStatus } from "./campaign-run";
import type { CampaignVictoryShipment } from "./campaign-victory-reward";

/**
 * How a campaign attempt ends (C9a): victory, defeat (the landing harbour fell or the script said so) or the
 * player's give-up (a restart gives up first). Nothing returns home after a defeat; otherwise the shipped soldiers
 * that are still alive sail home (owner answer Q-C1/Q-C2, review R7/R18). Unused goods never return (answer 6).
 */

/** The same ends the server's attempt route stores. */
export type CampaignRunEnd = CampaignAttemptEnd;

const END_STATUS: Readonly<Record<CampaignRunEnd, CampaignRunStatus>> =
  { defeat: "lost", giveUp: "given-up", victory: "won" };

/** The run's stored status after this end. */
const campaignRunEndStatus = (end: CampaignRunEnd) => END_STATUS[end];

/** The end a decided map outcome stands for; a running run ends by giving up. */
export const campaignRunEndOf = (status: CampaignRunStatus): CampaignRunEnd => {
  if (status === "won") return "victory";
  if (status === "lost") return "defeat";
  return "giveUp";
};

/**
 * The run after the simulation decided its map (BR2): the outcome's status and, for a victory through a named
 * exit, that exit. Only a script victory carries one, so a defeat never does.
 */
export const campaignRunWithOutcome = (
  run: CampaignRunState, { exit, kind }: Readonly<Pick<CampaignOutcomeRecord, "exit" | "kind">>
): CampaignRunState => {
  const { exit: _previous, ...rest } = run;
  const ended = { ...rest, status: campaignRunEndStatus(kind) };
  return kind === "victory" && exit !== undefined ? { ...ended, exit } : ended;
};

/** The exit an end report names: the won run's named exit; nothing for the implicit exit, a defeat or a give-up. */
export const campaignRunEndExit = (run: Pick<CampaignRunState, "exit">, end: CampaignRunEnd) =>
  end === "victory" ? run.exit : undefined;

const shippedCounts = (shipped: readonly CampaignSoldierAmount[] | undefined) => {
  const counts = new Map<string, number>();
  for (const line of shipped ?? []) counts.set(line.type, (counts.get(line.type) ?? 0) + line.amount);
  return counts;
};

/**
 * The soldiers that sail home: none after a defeat; else at most the shipped count per type, lowest rank first
 * (map-placed or Monument units are never shipped home in their place), then in save order. A commander keeps
 * his own transport (C10) and is never counted.
 */
export const campaignRunSurvivors = (
  run: Pick<CampaignRunState, "shippedSoldiers">, end: CampaignRunEnd, alive: readonly EmigratedTroop[]
): EmigratedTroop[] => {
  if (end === "defeat") return [];
  const room = shippedCounts(run.shippedSoldiers);
  const ordered = alive.map((troop, index) => ({ index, troop }))
    .sort((a, b) => a.troop.rank - b.troop.rank || a.index - b.index);
  const chosen = new Set<number>();
  for (const { index, troop } of ordered) {
    if (troop.commander) { chosen.add(index); continue; }
    const left = room.get(troop.type) ?? 0;
    if (left <= 0) continue;
    room.set(troop.type, left - 1);
    chosen.add(index);
  }
  return alive.filter((_troop, index) => chosen.has(index)).map(troop => ({ ...troop }));
};

/**
 * The settlers that sail home: none after a defeat; else the living settlers, at most as many as were shipped
 * (settlers born on the map never go home, owner Q3 follow-up). The home people limit trims them on arrival.
 */
export const campaignRunSettlers = (
  run: Pick<CampaignRunState, "shippedSettlers">, end: CampaignRunEnd, alive: number
) => end === "defeat" ? 0 : Math.max(0, Math.min(run.shippedSettlers ?? 0, alive));

/** What sails home at the end of a run. */
export interface CampaignRunReturn {
  /** A victory's reward-ship load (C12); absent after a defeat or give-up. */
  reward?: CampaignVictoryShipment;
  settlers: number;
  soldiers: readonly EmigratedTroop[];
}

const mergedGoods = (current: Readonly<Goods> | undefined, added: Readonly<Goods>) => {
  const merged: Goods = { ...current };
  for (const [ware, count] of Object.entries(added)) if (count > 0) merged[ware] = (merged[ware] ?? 0) + count;
  return Object.keys(merged).length ? merged : undefined;
};

/**
 * The home group after the run ended: its marker is gone; the survivors and the victory reward wait for the next
 * home visit, where the reward ship brings the goods and soldiers and the settlers are stored within the limit.
 */
export const endCampaignRunGroup = (
  group: Archipelago, { reward, settlers, soldiers }: CampaignRunReturn
): Archipelago => {
  const { campaign: _marker, ...rest } = group;
  const ended: Archipelago = { ...rest, active: null };
  const troops = [...soldiers, ...reward?.soldiers ?? []];
  const people = settlers + (reward?.settlers ?? 0);
  if (troops.length) ended.returning = [...(group.returning ?? []), ...troops];
  if (people > 0) ended.returningSettlers = (group.returningSettlers ?? 0) + people;
  const rewards = reward ? mergedGoods(group.rewards, reward.goods) : group.rewards;
  if (rewards) ended.rewards = rewards;
  return ended;
};
