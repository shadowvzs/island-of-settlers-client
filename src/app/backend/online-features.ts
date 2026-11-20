import type { OnlineFeatures } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import { createExternalStore, type ReadableStore } from "../components/ui-store";
import { ALL_ONLINE_FEATURES, CONFIG_FLAG_OF } from "./constants";

/**
 * The online feature switches of a `/config` body (already resolved by the server: offline and no-home rules
 * included). Only an explicit `false` hides a feature, so an older server or a malformed body changes nothing.
 */
export const readOnlineFeatures = (configBody: unknown): OnlineFeatures => {
  const flags = isPlainObject(configBody) && isPlainObject(configBody.features) ? configBody.features : {};
  const features = { ...ALL_ONLINE_FEATURES };
  for (const key of Object.keys(CONFIG_FLAG_OF) as (keyof OnlineFeatures)[])
    features[key] = flags[CONFIG_FLAG_OF[key]] !== false;
  return Object.freeze(features);
};

const store = createExternalStore<OnlineFeatures>(ALL_ONLINE_FEATURES);

/** The one place the UI asks which online features this game offers (comfort only: the server refuses). */
export const onlineFeatures: ReadableStore<OnlineFeatures> = store;

const isSameFeatures = (left: OnlineFeatures, right: OnlineFeatures) =>
  (Object.keys(CONFIG_FLAG_OF) as (keyof OnlineFeatures)[]).every(key => left[key] === right[key]);

/** Startup detection (or a game's own bundled settings) publishes the effective switches. */
export const publishOnlineFeatures = (features: OnlineFeatures) => {
  if (!isSameFeatures(store.getSnapshot(), features)) store.set(features);
};

export const isOnlineFeatureEnabled = (key: keyof OnlineFeatures) => store.getSnapshot()[key];

/** A window that never opens while its online feature is switched off, whoever asks (HUD, menu, map script). */
export const guardedByOnlineFeature = <Window extends { open: () => void }>(
  key: keyof OnlineFeatures, window: Window
): Window => ({
  ...window,
  open: () => {
    if (isOnlineFeatureEnabled(key)) window.open();
  }
});
