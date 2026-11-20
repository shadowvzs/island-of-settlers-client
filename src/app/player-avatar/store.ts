import {
  isPlayerAvatarGender,
  playerAvatarBody,
  type PlayerAvatarGender
} from "../../render-common/workers/player-avatar";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { createExternalStore } from "../components/ui-store";
import {
  readLocalPlayerAvatarGender,
  resolvePlayerAvatarGender,
  writeLocalPlayerAvatarGender
} from "./preference";

/** A small, renderer-safe description of the face the HUD and possessed explorer should show. */
export interface PlayerAvatarSelection {
  accountId: string | null;
  gender: PlayerAvatarGender;
  nation: WorkerNation;
}

/** Saves the choice to the signed-in account; false/throw keeps the local choice as fallback. */
export type SaveAccountAvatarGender = (gender: PlayerAvatarGender) => Promise<boolean>;

export type PlayerAvatarSaveResult = "account" | "failed" | "local";

export interface PlayerAvatarSeed {
  accountGender?: unknown;
  accountId?: string | null;
  /** Called only when a signed-in player changes the choice. */
  saveAccountGender?: SaveAccountAvatarGender;
  nation: WorkerNation;
}

const store = createExternalStore<PlayerAvatarSelection>({
  accountId: null,
  gender: "male",
  nation: "roman"
});
let saveAccountGender: SaveAccountAvatarGender | undefined;

/**
 * Startup seeds the one selection read by the HUD and the possessed explorer. An account profile
 * value wins, then the per-account local fallback, then the nation's canonical old portrait.
 */
export const initializePlayerAvatar = ({
  accountGender, accountId, nation, saveAccountGender: save
}: PlayerAvatarSeed) => {
  const id = accountId ?? null;
  const localGender = readLocalPlayerAvatarGender(id);
  const gender = resolvePlayerAvatarGender(accountGender, localGender, nation);
  saveAccountGender = save;
  store.set({ accountId: id, gender, nation });
  if (isPlayerAvatarGender(accountGender)) writeLocalPlayerAvatarGender(id, gender);
};

export const getPlayerAvatarSelection = () => store.getSnapshot();

export const subscribePlayerAvatar = store.subscribe;

/** Applies the choice at once, remembers it locally and updates the account when one is signed in. */
export const setPlayerAvatarGender = async (
  gender: PlayerAvatarGender
): Promise<PlayerAvatarSaveResult> => {
  if (!isPlayerAvatarGender(gender)) throw new Error(`Unknown player avatar gender: ${String(gender)}`);
  const current = store.getSnapshot();
  store.set({ ...current, gender });
  writeLocalPlayerAvatarGender(current.accountId, gender);
  if (!current.accountId || !saveAccountGender) return "local";
  try {
    return (await saveAccountGender(gender)) ? "account" : "failed";
  } catch {
    return "failed";
  }
};

/** Nation changes keep the chosen gender but update the face pair and portrait nation. */
export const setPlayerAvatarNation = (nation: WorkerNation) => {
  const current = store.getSnapshot();
  if (current.nation === nation) return;
  store.set({ ...current, nation });
};

/** The `body`/`gender`/`nation` recipe to pass into `createIslandExploration`. */
export const selectedExplorationPortrait = (nation = store.getSnapshot().nation) => {
  const { gender } = store.getSnapshot();
  return { body: playerAvatarBody(nation, gender).variant, gender, nation };
};
