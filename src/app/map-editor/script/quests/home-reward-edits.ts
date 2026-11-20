import type {
  DeclaredHomeReward, DeclaredRewardOccurrence, MapScript
} from "../../../../../../island-of-settlers-shared/src/script/types/script";
import { allocateId } from "../script-document";
import { itemUsers } from "../users";
import { DEFAULT_INTERVAL_DAYS, DEFAULT_REWARD_OCCURRENCES } from "./constants";

/**
 * Declared home rewards (design §4.14, §13.6): rewards triggers may grant, each with a stable id and an occurrence
 * rule; the server pays them only through the claim ledger. Removing one is refused while a trigger grants it.
 */

export const addHomeReward = (script: MapScript, name: string) => {
  const { id, script: next } = allocateId(script, "reward");
  const reward: DeclaredHomeReward = { id, name, occurrence: { kind: "once" }, rewards: [] };
  return { reward, script: { ...next, homeRewards: [...next.homeRewards, reward] } };
};

export const replaceHomeReward = (script: MapScript, reward: DeclaredHomeReward): MapScript =>
  ({ ...script, homeRewards: script.homeRewards.map(item => (item.id === reward.id ? reward : item)) });

export const homeRewardUsers = (script: MapScript, id: string) => itemUsers(script, ["reward"], id, `reward:${id}`);

export const removeHomeReward = (script: MapScript, id: string) => {
  const users = homeRewardUsers(script, id);
  if (users.length) return { changed: false as const, users };
  return { changed: true as const, script: { ...script,
    homeRewards: script.homeRewards.filter(item => item.id !== id) } };
};

/** The occurrence of a kind: once, a daily window, or a few counted grants. */
export const occurrenceOf = (kind: DeclaredRewardOccurrence["kind"]): DeclaredRewardOccurrence => {
  if (kind === "window") return { kind, repeat: { days: DEFAULT_INTERVAL_DAYS, hours: 0, kind: "interval",
    minutes: 0, retryAfterFail: false } };
  if (kind === "counter") return { kind, maxOccurrences: DEFAULT_REWARD_OCCURRENCES };
  return { kind };
};
