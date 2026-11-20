import { useLingui } from "@lingui/react";
import { useState } from "react";

import type {
  SeasonMode,
  VisualSeason
} from "../../../../../island-of-settlers-shared/src/appearance/season-calendar";
import type { SelectOption } from "../../components/helpers";
import { useExternalStore } from "../../components/external-store";
import type { SeasonChange } from "./api";
import { GLOBAL_SEASON_MESSAGES as G, SEASONAL_APPEARANCE_MESSAGES as M } from "./messages";
import { seasonalAppearance } from "./store";

const SEASON_ORDER: readonly VisualSeason[] = ["summer", "spring", "autumn", "winter", "monsoon"];
const MODE_ORDER: readonly SeasonMode[] = ["none", "two", "four"];
const MODE_LABELS = { four: G.modeFour, none: G.modeNone, two: G.modeTwo } as const;
const TRANSITIONS = [{ label: G.transitionLong, seconds: 180 }, { label: G.transitionShort, seconds: 30 }] as const;

/** The administrator's global season controls (Development panel); every change transitions gradually. */
export const useGlobalSeason = () => {
  const { i18n } = useLingui();
  const snapshot = useExternalStore(seasonalAppearance);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [transitionSeconds, setTransitionSeconds] = useState<number>(TRANSITIONS[0].seconds);

  const save = (change: SeasonChange) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    seasonalAppearance.setSeason({ ...change, transitionSeconds })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  const modeChoices: SelectOption<SeasonMode>[] =
    MODE_ORDER.map(mode => ({ label: i18n._(MODE_LABELS[mode]), value: mode }));
  const seasonChoices: SelectOption<VisualSeason>[] =
    SEASON_ORDER.map(season => ({ label: i18n._(G[season]), value: season }));
  const transitionChoices: SelectOption<number>[] =
    TRANSITIONS.map(choice => ({ label: i18n._(choice.label), value: choice.seconds }));
  let status = busy ? i18n._(M.saving) : "";
  if (!snapshot.online) status = i18n._(M.unavailable);
  return {
    error: failed ? i18n._(M.failed) : undefined,
    fixedSeason: snapshot.season.fixedSeason,
    fixedSeasonHint: i18n._(G.fixedSeasonHint),
    fixedSeasonLabel: i18n._(G.fixedSeason),
    hint: i18n._(G.hint),
    mode: snapshot.season.mode,
    modeChoices,
    modeLabel: i18n._(G.mode),
    seasonChoices,
    status,
    title: i18n._(G.title),
    transitionChoices,
    transitionLabel: i18n._(G.transition),
    transitionSeconds,
    onFixedSeasonChange: (fixedSeason: VisualSeason) => save({ fixedSeason }),
    onModeChange: (seasonMode: SeasonMode) => save({ seasonMode }),
    onTransitionChange: setTransitionSeconds
  };
};
