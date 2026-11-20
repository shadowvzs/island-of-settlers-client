import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { FACTION_AI_MODES, FACTION_AI_STYLES } from "../../../../shared/world/constants";
import { useExternalStore } from "../../../components/external-store";
import { getRewardIconsView } from "../../../settlement-ui/reward-icons/helpers";
import { DEPOT_SUMMARY_ICONS, FACTION_AI_BONUS_KEYS, FACTION_AI_LIMIT_KEYS } from "./constants";
import type { FactionAiControls } from "./faction-ai-controls";
import { factionAiView } from "./view-model";

const findIn = <T extends string>(values: readonly T[], id: string) => values.find(value => value === id);

/** The rows' view model (with depot summaries) and callbacks; re-built only when the copy or locale change. */
export const useFactionAi = (controls: FactionAiControls) => {
  const { i18n } = useLingui();
  const state = useExternalStore(controls.state);
  const view = useMemo(() => {
    const base = factionAiView(i18n, state);
    const rows = base.rows.map(row => ({ ...row, depotSummary: getRewardIconsView(row.details?.entries ?? [],
      { i18n, maxItems: DEPOT_SUMMARY_ICONS, nation: row.nation }) }));
    return { ...base, rows };
  }, [i18n, state]);
  return {
    ...view,
    issues: state.issues,
    onAdd: controls.addFaction,
    onBonusCommit: (faction: number, id: string, text: string) => {
      const key = findIn(FACTION_AI_BONUS_KEYS, id);
      if (key) controls.setBonus(faction, key, text);
    },
    onLevelChange: controls.setLevel,
    onLimitCommit: (faction: number, id: string, text: string) => {
      const key = findIn(FACTION_AI_LIMIT_KEYS, id);
      if (key) controls.setLimit(faction, key, text);
    },
    onModeChange: (faction: number, id: string) => {
      const mode = findIn(FACTION_AI_MODES, id);
      if (mode) controls.setMode(faction, mode);
    },
    onStartChange: controls.setStart,
    onStyleChange: (faction: number, id: string) => {
      const style = findIn(FACTION_AI_STYLES, id);
      if (style) controls.setStyle(faction, style);
    }
  };
};

export type FactionAiSectionView = ReturnType<typeof useFactionAi>;
export type FactionAiRowSectionView = FactionAiSectionView["rows"][number];
