import { useLingui } from "@lingui/react";
import { useEffect, useState } from "react";

import { translateMessage } from "../../shared/i18n/translate";
import {
  confirmationText, needsConfirmation, shownSlots, type SlotActionId, type SlotListMode, slotRow
} from "./helpers";
import { SAVE_SLOTS_MESSAGES as M } from "./messages";
import type { SaveSlotsControls, SlotResult } from "./slot-actions";
import type { SaveSlotEntry } from "./slot-meta";

interface PendingAction {
  action: SlotActionId;
  number: number;
}

export interface SaveSlotsOptions {
  controls: SaveSlotsControls;
  mode: SlotListMode;
}

/** Reads the slot list on mount (the window remounts the list on every opening) and after every action. */
const useSlotEntries = (controls: SaveSlotsControls) => {
  const [entries, setEntries] = useState<SaveSlotEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    controls.list().then(slots => {
      if (current) setEntries(slots);
      return slots;
    }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [controls]);
  const reload = async () => {
    try {
      setEntries(await controls.list());
    } catch {
      setFailed(true);
    }
  };
  return { entries, failed, reload };
};

/**
 * The Save/Load list (plan §5.6, §7.6): prepared rows, the confirmation of an overwrite, load or delete, the busy
 * state and the result line. The controls own every rule; the view only forwards choices.
 */
export const useSaveSlots = ({ controls, mode }: SaveSlotsOptions) => {
  const { i18n } = useLingui();
  const { entries, failed, reload } = useSlotEntries(controls);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const perform = async ({ action, number }: PendingAction) => {
    setPending(null);
    setBusy(true);
    const run: Record<SlotActionId, () => Promise<SlotResult>> = {
      delete: () => controls.remove(number),
      load: () => controls.load(number),
      save: () => controls.save?.(number, label) ?? Promise.resolve("failed")
    };
    const result = await run[action]();
    setBusy(false);
    setStatus(result === true
      ? translateMessage(i18n, M.done[action], { number }) : i18n._(M.failure[result]));
    if (action !== "load") await reload();
  };
  const choose = (action: SlotActionId, number: number) => {
    const used = entries?.some(entry => entry.number === number && entry.meta !== null) ?? false;
    if (needsConfirmation(action, used)) setPending({ action, number });
    else void perform({ action, number });
  };
  const confirmation = pending && confirmationText(pending.action, pending.number, i18n);
  return {
    busy,
    cancelLabel: i18n._(M.cancel),
    confirmation,
    label,
    labelPlaceholder: i18n._(M.label),
    labelShown: mode === "save",
    listLabel: i18n._(M.list),
    loadingText: failed ? i18n._(M.loadFailed) : i18n._(M.loading),
    rows: entries ? shownSlots(entries, mode).map(entry => slotRow(entry, mode, i18n)) : null,
    status,
    onCancel: () => setPending(null),
    onChoose: choose,
    onConfirm: () => { if (pending) void perform(pending); },
    onLabelChange: setLabel
  };
};

export type SaveSlotsModel = ReturnType<typeof useSaveSlots>;
