import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react";

import type { CampaignMap } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { TranslatableText } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import type { GameSettings } from "../../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { translateMessage } from "../../../../shared/i18n/translate";
import type { RewardEntry } from "../../../settlement-ui/reward-icons/entries";
import { useEditorMode } from "../../map-rules/use-editor-mode";
import type { CampaignEditor } from "../campaign-editor";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";
import { useCampaignEditorState } from "../use-campaign-editor";
import { stateBadge } from "../workspace-helpers";
import { WALLET_REWARD_FILTER, WALLET_REWARD_TABS } from "./constants";
import {
  cargoFromEntries, mapModeView, minimumLevelOf, toAmount, withMinimumLevel, withScopedRewardEntries, withSoldierCap
} from "./helpers";

type ModeWarningCode = keyof typeof M.gameMode.warnings;

/** The selected map's fields that follow the game mode (owner Q2): rewards by scope, launch cargo, warnings. */
const modeFields = (editor: CampaignEditor, map: CampaignMap, settings: GameSettings, i18n: I18n) => {
  const mode = mapModeView(map, settings);
  const G = M.gameMode;
  const { scope } = mode;
  const wallet = scope === "wallet";
  return {
    launch: mode.launchCargo && {
      entries: mode.launchCargo,
      soldierCap: map.soldierCap,
      soldierCapHint: translateMessage(i18n, G.launch.soldierCapHint),
      soldierCapLabel: translateMessage(i18n, G.launch.soldierCap),
      title: translateMessage(i18n, G.launch.title, { count: mode.launchCargo.length }),
      titleHint: translateMessage(i18n, G.launch.titleHint),
      onChange: (entries: RewardEntry[]) =>
        editor.updateMap(map.id, entry => ({ ...entry, requiredCargo: cargoFromEntries(entries) })),
      onSoldierCapChange: (value: string) => editor.updateMap(map.id, entry => withSoldierCap(entry, value))
    },
    modeWarnings: mode.warnings.map(({ code, count }) =>
      translateMessage(i18n, G.warnings[code as ModeWarningCode], { count })),
    rewards: scope !== "none" && {
      entries: mode.rewards,
      filter: wallet ? WALLET_REWARD_FILTER : undefined,
      tabs: wallet ? WALLET_REWARD_TABS : undefined,
      onChange: (entries: RewardEntry[]) => editor.updateMap(map.id, entry =>
        ({ ...entry, rewards: withScopedRewardEntries(entry.rewards, entries, scope) }))
    },
    rewardsNote: scope === "all" ? "" : translateMessage(i18n, G.rewardNotes[scope], { count: mode.hiddenRewards })
  };
};

/**
 * The selected map's settings: name, minimum level, its map file, Open map, Ready and Delete, and what the game
 * mode shows of it (rewards, launch cargo, warnings).
 */
export const useMapSettings = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  const { settings } = useEditorMode();
  const map = state.maps.find(entry => entry.id === state.selectedMapId);
  const emptyNote = translateMessage(i18n, M.notes.noMapSelected);
  const title = translateMessage(i18n, M.sections.mapSettings);
  if (!map) return { emptyNote, selected: null, title };
  const ready = map.state === "ready";
  return {
    emptyNote,
    selected: {
      ...modeFields(editor, map, settings, i18n),
      badge: stateBadge(map.state, i18n),
      busy: state.busy,
      deleteLabel: translateMessage(i18n, M.actions.deleteMap),
      fileNote: translateMessage(i18n, M.notes.mapFile, { slot: map.mapFile.id }),
      id: map.id,
      levelLabel: translateMessage(i18n, M.fields.minimumLevel),
      map,
      minimumLevel: minimumLevelOf(map),
      name: map.name,
      nameLabel: translateMessage(i18n, M.fields.name),
      openLabel: translateMessage(i18n, M.actions.openMap),
      ready,
      readyLabel: translateMessage(i18n, ready ? M.actions.markDraft : M.actions.markReady),
      rewardsTitle: translateMessage(i18n, M.sections.rewards),
      onLevelChange: (value: string) => editor.updateMap(map.id, entry => withMinimumLevel(entry, toAmount(value))),
      onNameChange: (name: TranslatableText) => editor.updateMap(map.id, entry => ({ ...entry, name }))
    },
    title
  };
};

export type SelectedMapView = NonNullable<ReturnType<typeof useMapSettings>["selected"]>;
