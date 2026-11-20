import { defaultHomeScript } from "../../../../island-of-settlers-shared/src/script/books/index";
import { mapScriptHash } from "../../../../island-of-settlers-shared/src/script/hash";
import { DAILY_QUEST_ID_PREFIX } from "../../shared/quests/constants";
import type { PendingHomeClaim } from "../../shared/settlement/settlement-home-claims";

/**
 * The v2 body of the unified claim route `POST /v1/economy/rewards/quests` (trigger design §9.4). It names the
 * claim (book by script hash, quest or declared reward, occurrence, UTC claim date); amounts never travel: the
 * server recomputes them from the published book.
 */
export interface QuestClaimBody {
  bonus?: { talentShare: number };
  claim:
    | { anchorUtc?: number; kind: "quest"; material?: "planks" | "stone"; questId: string }
    | { anchorUtc?: number; kind: "reward"; rewardId: string };
  claimedAt: string;
  occurrence: string;
  relief?: boolean;
  script: { bookId: string; mapHash: string | null; scriptHash: string };
  skip?: boolean;
  slotId?: string;
  v: 2;
}

/** A finished daily pool quest as the player session asks for it (the ledger id, material kind and talent). */
export interface DailyQuestClaim { bonus: number; material: "planks" | "stone"; questId: string; relief?: boolean }

let homeScriptHash: string | undefined;
const defaultHomeScriptHash = () => homeScriptHash ??= mapScriptHash(defaultHomeScript());

/** The global daily pool lives in the default home book; its occurrence is the ledger id `YYYY-MM-DD-i`. */
export const dailyQuestClaimBody = (claim: DailyQuestClaim, now: number): QuestClaimBody => ({
  bonus: { talentShare: claim.bonus },
  claim: { kind: "quest", material: claim.material, questId: `${DAILY_QUEST_ID_PREFIX}${claim.questId}` },
  claimedAt: new Date(now).toISOString(),
  occurrence: claim.questId,
  ...(claim.relief ? { relief: true } : {}),
  script: { bookId: defaultHomeScript().quests.id, mapHash: null, scriptHash: defaultHomeScriptHash() },
  v: 2
});

/** A declared home reward the island's script granted (`pendingHomeClaims`). */
export const homeRewardClaimBody = (pending: PendingHomeClaim, now: number, slotId?: string): QuestClaimBody => ({
  claim: { kind: "reward", rewardId: pending.rewardId,
    ...(pending.anchorUtc === null ? {} : { anchorUtc: pending.anchorUtc }) },
  claimedAt: new Date(now).toISOString(),
  occurrence: pending.occurrence,
  script: { bookId: pending.bookId, mapHash: null, scriptHash: pending.scriptHash },
  ...(slotId ? { slotId } : {}),
  v: 2
});
