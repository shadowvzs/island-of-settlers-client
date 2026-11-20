import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { COAST_FEEDBACK_LAYERS, COAST_OPERATIONS, type CoastReshapeEditor } from "../coast-reshape-editor";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import type { ScopedTerrainRestoreEditor } from "../scoped-terrain-restore-editor";
import {
  ActionButton, ActionRow, AuthoringControls, EditorSection, ListSelect, NumberField, StatusText
} from "./fields";
import { useSection } from "./use-section";

interface CoastSectionProps {
  editor: CoastReshapeEditor;
}
/** Bounded coast reshape: preview at the view centre with navigation feedback, then apply. */
export const CoastSection = ({ editor }: CoastSectionProps) => {
  const { field, view } = useSection(editor.section);
  const radius = field("radius"), strength = field("strength");
  return (
    <EditorSection info={M.help.coast} title={M.sections.coast}>
      <AuthoringControls>
        <ListSelect label={M.fields.coastOperation} options={COAST_OPERATIONS} value={view.mode}
          onChange={mode => editor.setOption({ mode })} />
        <NumberField {...radius} label={M.fields.brushRadius} max={12} min={2} size="narrow"
          onChange={value => editor.setOption({ radius: value })} />
        <NumberField {...strength} label={M.fields.brushStrength} max={1} min={.1} size="narrow" step=".1"
          onChange={value => editor.setOption({ strength: value })} />
        <ListSelect label={M.fields.coastFeedback} options={COAST_FEEDBACK_LAYERS} value={view.feedback}
          onChange={editor.setFeedback} />
        <ActionRow>
          <ActionButton caption={M.captions.preview} disabled={view.previewing} label={M.actions.previewCoast}
            onClick={editor.preview} />
          <ActionButton caption={M.captions.apply} disabled={view.commitDisabled} label={M.actions.applyCoast}
            onClick={editor.commit} />
          <ActionButton caption={M.captions.cancel} label={M.actions.cancelCoastPreview}
            onClick={editor.cancelPreview} />
        </ActionRow>
        <StatusText>{view.status}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};

interface ScopedRestoreSectionProps {
  editor: ScopedTerrainRestoreEditor;
}
/** Named baseline capture / restore and the saved-seed regeneration of a selected contour. */
export const ScopedRestoreSection = ({ editor }: ScopedRestoreSectionProps) => {
  const { i18n } = useLingui();
  const { view } = useSection(editor.section);
  const seed = useSection(editor.seedRegeneration.section).view;
  return (
    <EditorSection info={M.help.scopedRestore} title={M.sections.scopedRestore}>
      <AuthoringControls>
        <label className="map-editor__wide-field">
          {translateMessage(i18n, M.fields.baselineName)}
          <input maxLength={80} type="text" value={view.name}
            onChange={event => editor.setName(event.target.value)} />
        </label>
        <ActionRow>
          <ActionButton caption={M.captions.capture} disabled={view.busy} label={M.actions.captureBaseline}
            onClick={editor.capture} />
          <ActionButton caption={M.captions.restore} disabled={view.busy} label={M.actions.restoreBaseline}
            onClick={editor.restore} />
          <ActionButton caption={M.captions.regenerate} disabled={seed.disabled}
            label={M.actions.regenerateContour}
            onClick={editor.seedRegeneration.regenerate} />
          <ActionButton caption={M.captions.cancel} label={M.actions.cancelSavedSeed}
            onClick={editor.seedRegeneration.cancel} />
        </ActionRow>
        <StatusText>{view.status}</StatusText>
        <StatusText>{seed.status}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};
