import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { MAP_EDITOR_MESSAGES as M, resolveEditorText } from "../messages";
import { NAVIGATION_LAYERS, type NavigationOverlay } from "../navigation-overlay";
import type { PatrolEditor } from "../patrol-editor";
import type { ScenarioSpaceEditor } from "../scenario-space-editor";
import type { FieldOption } from "../section-store";
import {
  ActionButton, ActionRow, AuthoringControls, EditorSection, ListSelect, NumberField, StatusText
} from "./fields";
import { useSection } from "./use-section";
import { useScenarioSpace } from "./use-sections";

const NAVIGATION_OPTIONS: readonly FieldOption[] = Object.entries(NAVIGATION_LAYERS)
  .map(([value, message]) => ({ label: message, value }));

interface ScenarioSpaceSectionProps {
  editor: ScenarioSpaceEditor;
}
/** Worker inspection of startup space, walking components, roads and harbour clearance (advisory). */
export const ScenarioSpaceSection = ({ editor }: ScenarioSpaceSectionProps) => {
  const { i18n } = useLingui();
  const { authoredValidation, busy, findings, startupSpatial, summary } = useScenarioSpace(editor);
  return (
    <EditorSection info={M.help.scenarioSpace} title={M.sections.connectivity}>
      <div aria-busy={busy} className="map-editor__authoring-controls" data-authored-validation={authoredValidation}
        data-startup-spatial={startupSpatial}>
        <ActionRow>
          <ActionButton caption={M.captions.inspect} disabled={busy} label={M.actions.inspectConnectivity}
            onClick={editor.inspect} />
          <ActionButton caption={M.captions.hide} label={M.actions.hideInspection} onClick={editor.clear} />
        </ActionRow>
        <StatusText>{summary}</StatusText>
        <details>
          <summary>{translateMessage(i18n, M.inspection.summaryEvidence)}</summary>
          <ul>
            {findings.map((finding, index) => (
              <li key={index}>{resolveEditorText(i18n, finding)}</li>
            ))}
          </ul>
        </details>
      </div>
    </EditorSection>
  );
};

interface NavigationSectionProps {
  overlay: NavigationOverlay;
}
/** Local clearance of one navigation layer around the view centre. */
export const NavigationSection = ({ overlay }: NavigationSectionProps) => {
  const { view } = useSection(overlay.section);
  return (
    <EditorSection title={M.sections.localNavigation}>
      <AuthoringControls>
        <ListSelect label={M.fields.navigationLayer} options={NAVIGATION_OPTIONS} value={view.layer}
          onChange={overlay.setLayer} />
        <ActionRow>
          <ActionButton caption={M.captions.inspect} disabled={view.busy} label={M.actions.inspectNavigation}
            onClick={overlay.inspect} />
          <ActionButton caption={M.captions.hide} label={M.actions.hideNavigation} onClick={overlay.hide} />
        </ActionRow>
        <StatusText>{view.status}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};

interface PatrolSectionProps {
  editor: PatrolEditor;
}
/** Closed patrol loops of enemy field units. */
export const PatrolSection = ({ editor }: PatrolSectionProps) => {
  const { field, view } = useSection(editor.section);
  return (
    <EditorSection info={M.help.patrol} title={M.sections.patrol}>
      <AuthoringControls>
        <ListSelect label={M.fields.patrolUnit} options={view.units} value={view.unit} onChange={editor.selectUnit} />
        <ListSelect label={M.fields.patrolPoint} options={view.points} value={view.point}
          onChange={editor.selectPoint} />
        <NumberField {...field("x")} label={M.fields.patrolX} max={editor.limits.x} min={0} step="any" />
        <NumberField {...field("z")} label={M.fields.patrolZ} max={editor.limits.z} min={0} step="any" />
        <ActionRow>
          <ActionButton caption={M.captions.addPoint} label={M.actions.addPatrolPoint} onClick={editor.addPoint} />
          <ActionButton caption={M.captions.movePoint} label={M.actions.moveSelectedWaypoint}
            onClick={editor.movePoint} />
          <ActionButton caption={M.captions.removePoint} label={M.actions.removeWaypoint}
            onClick={editor.removePoint} />
        </ActionRow>
        <ActionRow>
          <ActionButton caption={M.captions.clearPatrol} label={M.actions.clearPatrol} onClick={editor.clear} />
          <ActionButton caption={M.captions.validate} label={M.actions.validatePatrol} onClick={editor.validate} />
          <ActionButton caption={M.captions.showLinks} icon="action:scout" label={M.actions.showLinks}
            onClick={editor.toggleLinks} />
        </ActionRow>
      </AuthoringControls>
    </EditorSection>
  );
};
