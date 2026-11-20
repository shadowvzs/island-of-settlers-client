import {
  migratePlayerProgress, type PlayerProgress, validatePlayerProgress
} from "../../shared/progression/player-progress";

/**
 * The player progress a slot without a home keeps between runs (GS3a; ONLINE-STORY for cloud slots): migrated as a
 * loaded save's, null when absent or invalid (never thrown).
 */
export const storyProgressOf = (value: unknown): PlayerProgress | null => {
  if (value === null || value === undefined) return null;
  try {
    const progress = migratePlayerProgress(value);
    return validatePlayerProgress(progress) ? progress : null;
  } catch {
    return null;
  }
};

/** The stored progress text of a browser slot's boot value. */
export const storedStoryProgress = (json: string | null): PlayerProgress | null => {
  if (!json) return null;
  try {
    return storyProgressOf(JSON.parse(json));
  } catch {
    return null;
  }
};
