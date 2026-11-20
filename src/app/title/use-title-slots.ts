import { useLingui } from "@lingui/react";
import { useState } from "react";

import { SAVE_SLOTS_MESSAGES } from "../save-slots/messages";
import type { SlotResult } from "../save-slots/slot-actions";
import { TITLE_MESSAGES as M } from "./messages";
import type { TitleSession } from "./title-session";
import type { TitleAction } from "./use-title-page";

/**
 * Continue, Load and New game on the title page (SAVE-SLOTS, plan §7.5): Continue may load the newest slot, Load opens
 * the slot list, New game asks first when it would replace a game or reset story progress.
 */
export const useTitleSlots = (session: TitleSession, openSlots: () => void) => {
  const { i18n } = useLingui();
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const runSlot = async (action: () => Promise<SlotResult>) => {
    setBusy(true);
    const result = await action().catch((): SlotResult => "failed");
    setBusy(false);
    if (result !== true) setStatus(i18n._(SAVE_SLOTS_MESSAGES.failure[result]));
  };
  const startNewGame = () => {
    setNewGameOpen(false);
    void runSlot(session.newGame);
  };
  return {
    newGameActions: [
      { icon: "apply", id: "newGame", label: i18n._(M.newGameConfirm), onClick: startNewGame },
      { icon: "cancel", id: "cancel", label: i18n._(M.cancel), onClick: () => setNewGameOpen(false) }
    ] satisfies TitleAction[],
    newGameOpen,
    newGameQuestion: i18n._(session.home ? M.newGameQuestion : M.newGameStoryQuestion),
    slotBusy: busy,
    slotStatus: status,
    onContinue: () => { void runSlot(session.continueGame); },
    onLoad: openSlots,
    onNewGame: () => {
      if (session.newGameAsks) setNewGameOpen(true);
      else void runSlot(session.newGame);
    }
  };
};
