import type { MessageDescriptor } from "@lingui/core";
import { useState } from "react";

import type { AdminIconName } from "../constants";
import { errorText } from "../helpers";
import type { ConfirmRequestState } from "../use-confirm-request";
import { type CampaignRowModel, campaignRows, type StarterRowModel, starterRows } from "./helpers";
import type { MaintenancePort } from "./maintenance-ports";
import { MAINTENANCE_MESSAGES as M } from "./messages";
import type { MaintenanceData } from "./use-maintenance-data";

type Translate = (descriptor: MessageDescriptor, values?: Record<string, unknown>) => string;

interface ContentRowsOptions {
  confirm: ConfirmRequestState;
  data: MaintenanceData;
  server: MaintenancePort | null;
  t: Translate;
  onChanged: () => Promise<void>;
}

const campaignActionLabel = ({ campaign, nextState }: CampaignRowModel, t: Translate) => nextState === "ready"
  ? t(M.tools.M8Publish, { name: campaign.name })
  : t(M.tools.M8Unpublish, { name: campaign.name });

const starterText = ({ revision }: StarterRowModel) => {
  const when = revision.createdAt ? ` · ${new Date(revision.createdAt).toLocaleString()}` : "";
  return `#${revision.revision} · ${revision.name}${when}`;
};

/** M8 campaigns Ready ↔ Draft, M9 starter rollback (both player-visible, confirmed) and the M10 winter switch. */
export const useContentRows = ({ confirm, data, onChanged, server, t }: ContentRowsOptions) => {
  const [winterError, setWinterError] = useState("");

  const confirmContentChange = (label: string, work: () => Promise<void>) => confirm.open({
    confirmLabel: t(M.confirm.run, { tool: label }), expected: null, lines: [t(M.confirm.playerVisible)],
    option: null,
    run: async () => {
      await work();
      await onChanged();
      return t(M.status.done, { tool: label });
    },
    title: label
  });

  const campaigns = campaignRows(data.campaigns).map(row => ({
    icon: (row.nextState === "ready" ? "apply" : "cancel") as AdminIconName,
    id: row.campaign.id,
    label: campaignActionLabel(row, t),
    name: row.campaign.name,
    onToggle: () => confirmContentChange(campaignActionLabel(row, t),
      async () => server?.setCampaignState(row.campaign, row.nextState)),
    state: row.campaign.state === "ready" ? t(M.content.stateReady) : t(M.content.stateDraft)
  }));

  const currentHash = data.starter?.current?.hash ?? null;
  const starter = starterRows(data.starter).map(row => ({
    current: row.current,
    currentLabel: t(M.content.current),
    id: `${row.revision.mapId}:${row.revision.revision}`,
    label: t(M.tools.M9, { revision: row.revision.revision }),
    onRollback: () => confirmContentChange(t(M.tools.M9, { revision: row.revision.revision }),
      async () => server?.rollbackStarter(row.revision, currentHash)),
    text: starterText(row)
  }));

  const setWinter = async (enabled: boolean) => {
    setWinterError("");
    try {
      await server?.setGlobalWinter(enabled);
      await onChanged();
    } catch (failure) {
      setWinterError(errorText(failure));
    }
  };

  return {
    bundleNote: t(M.tools.M8Bundle),
    campaigns,
    campaignsEmpty: data.campaigns.length ? "" : t(M.content.noCampaigns),
    campaignsTitle: t(M.content.campaigns),
    setWinter,
    starter,
    starterEmpty: starter.length ? "" : t(M.content.noStarter),
    starterTitle: t(M.content.starter),
    winter: data.globalWinter,
    winterError
  };
};
