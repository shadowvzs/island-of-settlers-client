import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import { raiseTalent, talentRaiseCheck } from "../../../shared/progression/talents";
import { COMMAND_PENDING, settleCommand } from "../../components/helpers";
import { isShallowEqual } from "../../components/ui-store";
import { useCommandStatus } from "../../components/use-command-status";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { useWindowSelector } from "../use-window-selector";
import {
  applyTalentDraft, currentTalentDraft, emptyTalentDraft, getTalentApplySuccess, getTalentWindowModel,
  mergeTalentDraft, resetAppliedTalentTree, selectTalentPlayer
} from "./helpers";
import { talentName } from "./talent-text";

type TalentOptions = Pick<SettlementUiOptions, "onApplyTalents" | "onResetTalents">;

/**
 * Pending points are a local draft on top of the applied ranks: placing points, Reset of pending
 * points (free), Apply, and the two-step paid reset after Apply. The draft and the status belong to
 * one opening: closing the window discards unapplied points (owner 2026-10-21).
 */
export const useTalents = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, options: TalentOptions
) => {
  const { i18n } = useLingui();
  const { opened, selection: player } = useWindowSelector(
    store, visibility, selectTalentPlayer, isShallowEqual, i18n.locale);
  const [storedDraft, setDraft] = useState(() => emptyTalentDraft(opened));
  const { confirmingReset, points } = currentTalentDraft(storedDraft, opened);
  const { report, status } = useCommandStatus(getTalentApplySuccess(i18n), `${opened}:${i18n.locale}`);
  const draft = useMemo(() => mergeTalentDraft(player.talents, points), [points, player.talents]);
  const model = useMemo(() => getTalentWindowModel(player, draft, confirmingReset, i18n),
    [confirmingReset, draft, i18n, player]);
  const clearDraft = () => setDraft(emptyTalentDraft(opened));
  const onRaise = (id: string) => {
    const check = talentRaiseCheck(draft, id, player.level);
    if (check !== true) { report(`${talentName(id, i18n)}: ${check}`); return; }
    report("");
    setDraft({ confirmingReset: false, opened, points: raiseTalent(draft, id, player.level) });
  };
  const onApply = () => {
    const result = applyTalentDraft(options, draft, i18n);
    if (result === true) clearDraft();
    report(result);
  };
  const resetApplied = () => settleCommand(resetAppliedTalentTree(options, i18n), result => {
    clearDraft();
    report(result === true ? i18n._(M.talents.freeAgain) : result);
  }, () => report(COMMAND_PENDING));
  /**
   * Pending points go back for free; applied ones after a confirming second press. A dimmed button
   * keeps focus (aria-disabled, so Escape still reaches the window) and reports the shared rule's reason.
   */
  const onReset = () => {
    if (model.pendingPoints > 0) { clearDraft(); report(i18n._(M.talents.pendingBack)); return; }
    if (confirmingReset || model.reset.disabled) { resetApplied(); return; }
    setDraft({ confirmingReset: true, opened, points });
  };
  return { model, status, onApply, onRaise, onReset };
};
