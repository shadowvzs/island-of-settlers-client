import { useLingui } from "@lingui/react";
import { type ChangeEvent, type KeyboardEvent, useRef } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { formatSaveDate } from "../helpers";
import type { MapLibrary, MapLibraryState } from "../map-library";
import type { MapSlot } from "../map-storage";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "../messages";
import { useMapLibraryState } from "./use-history";

export const MAX_MAP_NAME_LENGTH = 40;


/** Runs the action once the player confirms the question (the browser's own dialog). */
const withConfirm = (question: string, action: () => void) => () => {
  if (confirm(question)) action();
};

/** One immutable shared-starter revision; the current one cannot be rolled back to itself. */
export interface CatalogRow {
  current: boolean;
  date: string;
  id: string;
  name: string;
  onRollback: () => void;
  revision: number;
}

/** A saved map's row: its name, save date and confirmed actions. */
export interface SlotRow {
  date: string;
  id: string;
  name: string;
  onDelete: () => void;
  onLoad: () => void;
  onOverwrite: () => void;
}

const toCatalogRow = (
  library: Pick<MapLibrary, "rollbackStarter">,
  revision: { createdAt?: string; mapId: string; metadata: { name: string }; revision: number },
  current: boolean,
  i18n: Parameters<typeof translateMessage>[0]
): CatalogRow => ({
  current,
  date: revision.createdAt ? formatSaveDate(Date.parse(revision.createdAt)) : "",
  id: `${revision.mapId}:${revision.revision}`,
  name: revision.metadata.name,
  onRollback: withConfirm(translateMessage(i18n, M.library.rollbackConfirm, {
    name: revision.metadata.name, revision: revision.revision
  }), () => library.rollbackStarter(revision.mapId, revision.revision)),
  revision: revision.revision
});

const toSlotRow = (library: Pick<MapLibrary, "deleteSlot" | "loadSlot" | "overwriteSlot">,
  { id, name, savedAt }: MapSlot, i18n: Parameters<typeof translateMessage>[0]): SlotRow => ({
  date: formatSaveDate(savedAt),
  id,
  name,
  onDelete: withConfirm(translateMessage(i18n, M.library.confirmDelete, { name }), () => library.deleteSlot(id)),
  onLoad: withConfirm(translateMessage(i18n, M.library.confirmLoadSlot, { name }), () => library.loadSlot(id)),
  onOverwrite: withConfirm(translateMessage(i18n, M.library.confirmOverwrite, { name }),
    () => library.overwriteSlot(id))
});

/** The note under the slots: why there are none, hidden while slots are listed. */
export const getSlotsNote = ({ slots, storage }: Pick<MapLibraryState, "slots" | "storage">) => ({
  note: (storage ? M.library.noSlots : M.library.blocked) as EditorText,
  noteHidden: storage && slots.length > 0
});

/** The line that says Save writes the campaign slot (null for the World01 editor). */
export const getCampaignNote = (campaignSlot: string | null): EditorText | null =>
  campaignSlot === null ? null : editorMessage(M.library.campaignEditing, { slot: campaignSlot });

/** Typing a name must not pan the camera (arrow keys) or switch the view (C). */
const keepKeysInside = (event: KeyboardEvent<HTMLInputElement>) => event.stopPropagation();

/** The Map section: library state, the hidden file picker and confirmed slot actions. */
export const useMapSection = (library: MapLibrary) => {
  const { i18n } = useLingui();
  const state = useMapLibraryState(library);
  const picker = useRef<HTMLInputElement>(null);
  const onFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    withConfirm(translateMessage(i18n, M.library.confirmLoadFile, { name: file.name }),
      () => library.loadFile(file))();
  };
  const current = state.catalog?.current;
  const revisions = state.catalog?.revisions ?? [];
  return {
    ...getSlotsNote(state),
    busy: state.busy,
    campaignNote: getCampaignNote(state.campaignSlot),
    campaignSlot: state.campaignSlot !== null,
    catalog: revisions.map(revision => toCatalogRow(library, revision,
      revision.mapId === current?.mapId && revision.revision === current?.revision, i18n)),
    catalogError: state.catalogError,
    catalogLoaded: state.catalog !== null,
    currentStarter: current,
    name: state.name,
    picker,
    slots: state.slots.map(slot => toSlotRow(library, slot, i18n)),
    storage: state.storage,
    onFileChosen,
    onLoadFile: () => picker.current?.click(),
    onNameChange: library.setName,
    onNameKey: keepKeysInside
  };
};
