import {
  DEFAULT_PLAYER_AVATAR_GENDER,
  isPlayerAvatarGender,
  type PlayerAvatarGender
} from "../../render-common/workers/player-avatar";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { choiceCodec } from "../preferences/codecs";
import { PREFERENCE_FAMILIES, PREFERENCES } from "../preferences/keys";
import { definePreference, definePreferenceFamily } from "../preferences/registry";

const genderCodec = choiceCodec(isPlayerAvatarGender, null);
/** Guest fallback key; signed-in accounts get a key with their account id appended. */
const guestAvatarGender = definePreference(PREFERENCES.playerAvatarGender, genderCodec);
const accountAvatarGender = definePreferenceFamily(PREFERENCE_FAMILIES.playerAvatarGender, genderCodec);

const avatarGenderPreference = (accountId?: string | null) =>
  accountId ? accountAvatarGender(accountId.toLowerCase()) : guestAvatarGender;

export const playerAvatarGenderStorageKey = (accountId?: string | null) => avatarGenderPreference(accountId).key;

/** The locally remembered choice (accounts normally also have it in their profile). */
export const readLocalPlayerAvatarGender = (accountId?: string | null): PlayerAvatarGender | null =>
  avatarGenderPreference(accountId).read();

export const writeLocalPlayerAvatarGender = (
  accountId: string | null | undefined,
  gender: PlayerAvatarGender
) => { avatarGenderPreference(accountId).write(gender); };

/**
 * The account field wins when valid; otherwise the local fallback, then the nation's old canonical
 * portrait gender. This keeps old accounts and saves on today's portrait and validates both sources.
 */
export const resolvePlayerAvatarGender = (
  accountGender: unknown,
  localGender: unknown,
  nation: WorkerNation
): PlayerAvatarGender => {
  if (isPlayerAvatarGender(accountGender)) return accountGender;
  if (isPlayerAvatarGender(localGender)) return localGender;
  return DEFAULT_PLAYER_AVATAR_GENDER[nation];
};
