import type { CampaignSyncConflict, CampaignSyncReport } from "../../campaign-storage/campaign-sync";
import { editorMessage } from "../messages";
import { type CampaignEditorCore, errorReason } from "./campaign-editor-core";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "./messages";

/** The server sync of the campaign editor (CAMPAIGN-SERVER-STORAGE): run, reload what changed, say what happened. */
export const createCampaignServerActions = (core: CampaignEditorCore) => {
  const { deps, state } = core;

  /** Records received or deleted by the sync replace the list and the open campaign's working copies. */
  const reload = async () => {
    const { draft, selectedMapId } = state();
    await core.refreshList();
    if (!draft) return;
    if (state().campaigns.some(campaign => campaign.id === draft.id)) await core.select(draft.id, selectedMapId);
    else core.clearSelection();
  };

  const conflictName = ({ kept, name }: CampaignSyncConflict) =>
    deps.translate(editorMessage(kept === "local" ? M.status.syncKeptLocal : M.status.syncKeptServer, { name }));

  /** Conflicts are always named (owner rule); a start-up sync that moved nothing stays silent. */
  const announce = ({ conflicts, received, removed, sent }: CampaignSyncReport, quiet: boolean) => {
    const summary = editorMessage(M.status.synced, { received, removed, sent });
    if (conflicts.length) {
      const names = conflicts.map(conflictName).join(", ");
      core.notify(editorMessage(M.status.syncConflicts, { names, summary: deps.translate(summary) }), true);
      return;
    }
    if (received + removed + sent > 0) { core.notify(summary); return; }
    if (!quiet) core.notify(M.status.syncUnchanged);
  };

  return {
    /** `quiet`: the start-up sync, which says nothing when no server is available or nothing moved. */
    syncWithServer: (quiet = false) => core.run(async () => {
      if (!deps.serverSync) { if (!quiet) core.notify(M.notes.serverNone, true); return; }
      if (state().dirty) { core.notify(M.status.syncNeedsSave, true); return; }
      try {
        const report = await deps.serverSync();
        if (report.received + report.removed > 0) await reload();
        core.set({ server: "connected" });
        announce(report, quiet);
      } catch (error) {
        core.set({ server: "failed" });
        core.notify(editorMessage(M.status.syncFailed, { reason: errorReason(error) }), true);
      }
    })
  };
};
