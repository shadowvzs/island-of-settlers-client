import type { CampaignEditorCore } from "./campaign-editor-core";
import type { CampaignEditorJump } from "./campaign-editor-state";
import { type CampaignTextEntry, collectCampaignTexts, recordTextEdit, withTextValue } from "./campaign-texts";

/**
 * Translation table edits (CUX-I18N-TABLE) and Check panel jumps: every write goes through the same working-copy
 * updates as the section forms (`updateDraft` / `updateMap`), so Save, the unsaved mark and the Ready re-check
 * behave the same. The undo stack lives in the editor state and is cleared with the selection.
 */
export const createCampaignTextActions = (core: CampaignEditorCore) => {
  const { state } = core;

  const findText = (textId: string) => {
    const { draft, maps } = state();
    return draft ? collectCampaignTexts(draft, maps).find(text => text.id === textId) : undefined;
  };

  const write = (text: CampaignTextEntry, language: string, value: string) => {
    const { mapId, path } = text;
    if (mapId) core.updateMap(mapId, map => withTextValue(map, path, language, value));
    else core.updateDraft(campaign => withTextValue(campaign, path, language, value));
  };

  return {
    /** Shows a section tab (selecting the map first); a text id also focuses its translation table cell. */
    jumpTo: (target: Omit<CampaignEditorJump, "revision"> & { mapId?: string | null }) => {
      const { mapId, ...jump } = target;
      const revision = (state().jump?.revision ?? 0) + 1;
      core.set({ jump: { ...jump, revision }, selectedMapId: mapId ?? state().selectedMapId });
    },
    /** One language of one campaign text; an unknown id (a text deleted meanwhile) changes nothing. */
    setText: (textId: string, language: string, value: string) => {
      const text = findText(textId);
      if (!text) return;
      const previous = text.text[language] ?? "";
      if (previous === value) return;
      core.set({ textEdits: recordTextEdit(state().textEdits, { language, previous, textId }) });
      write(text, language, value);
    },
    /** Restores the cell of the newest undo step (steps of texts deleted meanwhile are dropped). */
    undoTextEdit: () => {
      const edit = state().textEdits.at(-1);
      if (!edit) return;
      core.set({ textEdits: state().textEdits.slice(0, -1) });
      const text = findText(edit.textId);
      if (text) write(text, edit.language, edit.previous);
    }
  };
};
