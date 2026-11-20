import {
  isVisualSeason,
  MAX_TRANSITION_SECONDS,
  type SeasonSettings
} from "../../../../../island-of-settlers-shared/src/appearance/season-calendar";

/**
 * Dev captures (seasons-1 receipt): `?season=autumn[&seasonFrom=summer&seasonBlend=0.5]` shows a fixed
 * season, or a transition frozen at a blend (the longest transition, so it barely moves while captured).
 */
export const readSeasonPreviewQuery = (search: string, nowMs: number): SeasonSettings | null => {
  const query = new URLSearchParams(search);
  const season = query.get("season");
  if (!isVisualSeason(season)) return null;
  const from = query.get("seasonFrom");
  const blend = Math.min(1, Math.max(0, Number(query.get("seasonBlend") ?? 1) || 0));
  const previousSeason = isVisualSeason(from) ? from : season;
  return {
    changedAt: nowMs - blend * MAX_TRANSITION_SECONDS * 1000, fixedSeason: season, mode: "none", previousSeason,
    transitionSeconds: MAX_TRANSITION_SECONDS
  };
};
