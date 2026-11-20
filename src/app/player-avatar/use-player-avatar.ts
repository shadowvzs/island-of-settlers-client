import { useSyncExternalStore } from "react";

import {
  getPlayerAvatarSelection,
  type PlayerAvatarSelection,
  subscribePlayerAvatar} from "./store";

/** The current selection; re-renders the HUD and customization panel when it changes. */
export const usePlayerAvatarSelection = (): PlayerAvatarSelection =>
  useSyncExternalStore(subscribePlayerAvatar, getPlayerAvatarSelection, getPlayerAvatarSelection);

/** Only the face gender, for the HUD's portrait style memo. */
export const usePlayerAvatarGender = () => usePlayerAvatarSelection().gender;
