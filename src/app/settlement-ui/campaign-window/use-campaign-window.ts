import { useLingui } from "@lingui/react";
import { useEffect, useMemo, useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { useKeyedStatus } from "../../components/use-command-status";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { useWindowSelector } from "../use-window-selector";
import { REQUIREMENT_REFRESH_MS } from "./constants";
import {
  campaignDepartModel, campaignMapRows, campaignOptions, campaignStartStatus, currentCampaign, currentMap,
  selectCampaignNation
} from "./helpers";
import { CAMPAIGN_WINDOW_MESSAGES as M } from "./messages";
import { pathGraphModel } from "./path-graph-helpers";
import { campaignBusyText, campaignStartModel, type CampaignWindowFrame } from "./start-frame-helpers";
import { CAMPAIGN_START_MESSAGES as S } from "./start-messages";
import type { CampaignChoice, CampaignWindowPort } from "./types";

interface LoadedCampaigns {
  choices: CampaignChoice[];
  opened: number;
}

/** The ready campaigns of one opening: read again on every open, so new lock state shows after a run. */
const useCampaignChoices = (port: CampaignWindowPort, opened: number, visible: boolean) => {
  const [loaded, setLoaded] = useState<LoadedCampaigns | null>(null);
  useEffect(() => {
    if (!visible) return undefined;
    let current = true;
    const show = (choices: CampaignChoice[]) => { if (current) setLoaded({ choices, opened }); };
    void port.load().then(show, () => show([]));
    return () => { current = false; };
  }, [opened, port, visible]);
  return loaded?.opened === opened ? loaded.choices : null;
};

/** A counter that advances while the window is visible: the launch check follows the home stock. */
const useRequirementRefresh = (visible: boolean) => {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setInterval(() => setRevision(value => value + 1), REQUIREMENT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [visible]);
  return revision;
};

export interface CampaignWindowSource {
  frame: CampaignWindowFrame;
  /** The campaign shown first (the title page's landing); absent = the first offered one. */
  initialCampaignId?: string;
  /** Nation of the soldier portraits. */
  nation: string;
  /** Opening counter: every new opening reads the records again. */
  opened: number;
  port: CampaignWindowPort;
  visible: boolean;
}

/**
 * Campaign window state (C8; GS3b frames): the chosen campaign and map are a local draft, the lock state comes
 * with the records, the launch check is the session's shared answer and Set sail (home) or Start map (title page)
 * hands the map to the port. Only the home frame follows the home stock.
 */
export const useCampaignWindowModel = (
  { frame, initialCampaignId, nation, opened, port, visible }: CampaignWindowSource
) => {
  const { i18n } = useLingui();
  const choices = useCampaignChoices(port, opened, visible);
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId ?? null);
  const [mapId, setMapId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [graphShown, setGraphShown] = useState(false);
  const { setStatus, status } = useKeyedStatus(`${opened}:${i18n.locale}`);
  const revision = useRequirementRefresh(visible && frame === "home");
  const campaign = currentCampaign(choices ?? [], campaignId), selected = currentMap(campaign, mapId);
  // `revision` re-reads the launch check while the home stock changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const requirements = useMemo(() => selected && port.requirements(selected.map), [port, revision, selected]);
  const depart = selected && requirements && frame === "home"
    ? campaignDepartModel(selected.node, requirements, nation, busy, i18n) : null;
  const start = selected && requirements && frame === "start"
    ? campaignStartModel(selected.node, requirements, busy, i18n) : null;
  const onDepart = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setStatus(campaignBusyText(frame, i18n));
    const result = await port.start(selected.map).catch(() => "");
    setBusy(false);
    setStatus(campaignStartStatus(result, i18n));
  };
  return {
    campaignId: campaign?.campaign.id ?? "",
    campaigns: campaignOptions(choices ?? [], i18n),
    completedNote: campaign?.completed ? translateMessage(i18n, M.completed) : "",
    depart,
    graph: graphShown ? pathGraphModel(campaign, selected?.map.id, i18n) : null,
    graphShown,
    hasMap: Boolean(selected),
    loading: choices === null,
    rows: campaignMapRows(campaign, selected?.map.id, i18n),
    start,
    status,
    text: {
      campaign: translateMessage(i18n, M.campaign),
      cargo: translateMessage(i18n, M.cargo),
      depart: translateMessage(i18n, M.depart),
      empty: translateMessage(i18n, M.empty),
      loading: translateMessage(i18n, M.loading),
      maps: translateMessage(i18n, M.maps),
      paths: translateMessage(i18n, M.paths),
      start: translateMessage(i18n, S.action)
    },
    onCampaign: (id: string) => { setCampaignId(id); setMapId(null); },
    onDepart: () => { void onDepart(); },
    onMap: setMapId,
    onToggleGraph: () => setGraphShown(shown => !shown)
  };
};

/** The home island's campaign window: the nation and visibility come from the settlement window stores. */
export const useCampaignWindow = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, port: CampaignWindowPort
) => {
  const { i18n } = useLingui();
  const { opened, selection: nation, visible } = useWindowSelector(
    store, visibility, selectCampaignNation, Object.is, i18n.locale);
  return useCampaignWindowModel({ frame: "home", nation, opened, port, visible });
};

export type CampaignWindowModel = ReturnType<typeof useCampaignWindowModel>;
