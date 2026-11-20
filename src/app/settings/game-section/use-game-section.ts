import { useLingui } from "@lingui/react";
import { useState } from "react";

import { toBusyLabel } from "../../account/form/helpers";
import { useSubmitOnce } from "../../account/form/use-submit-once";
import type { GameSectionSlots } from "./game-section";
import { GAME_SECTION_MESSAGES as M } from "./messages";

/** Exit game while automatic saving is off: Save to slot… opens the window, Leave without saving discards. */
const useExitChoice = (slots: GameSectionSlots | undefined, close: () => void) => {
  const { i18n } = useLingui();
  const form = useSubmitOnce(i18n._(M.leaveFailed), async () => {
    if (await slots?.leaveWithoutSaving()) return true;
    throw new Error(i18n._(M.leaveFailed));
  });
  return {
    leaveBusyLabel: toBusyLabel(form.busy, i18n._(M.leaving)),
    leaveStatus: form.status,
    onLeaveWithoutSaving: () => void form.submit(),
    onSaveToSlot: () => {
      close();
      slots?.open("save");
    }
  };
};

/**
 * Settings > Misc > Game state: the Exit game question is open or closed (a new key per opening); with automatic
 * saving off it offers Save to slot… / Leave without saving / Cancel (plan §7.3), else Save and exit.
 */
export const useGameSection = (slots: GameSectionSlots | undefined) => {
  const { i18n } = useLingui();
  const [opening, setOpening] = useState(0);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const choice = useExitChoice(slots, close);
  return {
    ...choice,
    confirmKey: opening,
    exitChoiceOpen: open && Boolean(slots?.manualSaving),
    exitConfirmOpen: open && !slots?.manualSaving,
    slotsShown: Boolean(slots),
    text: {
      exit: i18n._(M.exit),
      exitConfirm: i18n._(M.exitConfirm),
      exitQuestion: i18n._(M.exitQuestion),
      leaveWithoutSaving: i18n._(M.leaveWithoutSaving),
      load: i18n._(M.load),
      manualExitQuestion: i18n._(M.manualExitQuestion),
      save: i18n._(M.save),
      saveToSlot: i18n._(M.saveToSlot),
      title: i18n._(M.title)
    },
    onClose: close,
    onLoad: () => slots?.open("load"),
    onOpen: () => { setOpening(value => value + 1); setOpen(true); },
    onSave: () => slots?.open("save")
  };
};
