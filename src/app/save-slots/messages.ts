import { msg } from "@lingui/core/macro";

/** Save/Load slots copy (SAVE-SLOTS, plan §5.6, §7.6). English only; GM-I18N fills the other catalogs. */
export const SAVE_SLOTS_MESSAGES = {
  action: {
    delete: msg({ id: "saveSlots.action.delete", message: "Delete" }),
    load: msg({ id: "saveSlots.action.load", message: "Load" }),
    save: msg({ id: "saveSlots.action.save", message: "Save here" })
  },
  cancel: msg({ id: "saveSlots.cancel", message: "Cancel" }),
  confirm: {
    delete: msg({ id: "saveSlots.confirm.delete", message: "Delete" }),
    deleteQuestion: msg({ id: "saveSlots.confirm.deleteQuestion", message: "Delete the save in slot {number}?" }),
    load: msg({ id: "saveSlots.confirm.load", message: "Load" }),
    loadQuestion: msg({
      id: "saveSlots.confirm.loadQuestion", message: "Load slot {number}? Progress since your last save is lost."
    }),
    save: msg({ id: "saveSlots.confirm.save", message: "Replace" }),
    saveQuestion: msg({ id: "saveSlots.confirm.saveQuestion", message: "Replace the save in slot {number}?" })
  },
  done: {
    delete: msg({ id: "saveSlots.done.delete", message: "Slot {number} deleted" }),
    load: msg({ id: "saveSlots.done.load", message: "Loading slot {number}…" }),
    save: msg({ id: "saveSlots.done.save", message: "Saved to slot {number}" })
  },
  empty: msg({ id: "saveSlots.empty", message: "Empty slot" }),
  failure: {
    busy: msg({ id: "saveSlots.failure.busy", message: "Saving is not possible right now" }),
    failed: msg({ id: "saveSlots.failure.failed", message: "The save slot could not be read or written" }),
    noIndexedDb: msg({ id: "saveSlots.failure.noIndexedDb", message: "Save slots need IndexedDB in this browser" }),
    saveFailed: msg({ id: "saveSlots.failure.saveFailed", message: "The game could not be saved" }),
    storageFull: msg({ id: "saveSlots.failure.storageFull", message: "Not enough browser storage: delete a save" })
  },
  heading: msg({ id: "saveSlots.heading", message: "Saved games" }),
  kind: {
    adventure: msg({ id: "saveSlots.kind.adventure", message: "Adventure" }),
    campaign: msg({ id: "saveSlots.kind.campaign", message: "Campaign map" }),
    colony: msg({ id: "saveSlots.kind.colony", message: "Colony" }),
    home: msg({ id: "saveSlots.kind.home", message: "Home island" })
  },
  label: msg({ id: "saveSlots.label", message: "Save name (optional)" }),
  level: msg({ id: "saveSlots.level", message: "Level {level}" }),
  list: msg({ id: "saveSlots.list", message: "Save slots" }),
  loading: msg({ id: "saveSlots.loading", message: "Reading saved games…" }),
  loadFailed: msg({ id: "saveSlots.loadFailed", message: "Saved games could not be read" }),
  slot: msg({ id: "saveSlots.slot", message: "Slot {number}" })
};
