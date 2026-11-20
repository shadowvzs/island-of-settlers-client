import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import type { GeneratedFeatureInspector } from "../generated-feature-inspector";
import type { GeneratedFeatureTransformControls } from "../generated-feature-transform-controls";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import type { OriginalFeatureSelector } from "../original-feature-selector";
import type { FieldOption } from "../section-store";
import {
  ActionButton, ActionRow, AuthoringControls, EditorSection, HelpNote, ListSelect, NumberField, StatusText
} from "./fields";
import { useSection } from "./use-section";

const CONTOUR_KINDS: readonly FieldOption[] = [
  { label: M.option.contourKind.water, value: "water" },
  { label: M.option.contourKind.relief, value: "relief" }
];

interface OriginalFeatureSectionProps {
  selector: OriginalFeatureSelector;
}
/** Original generator sources (massifs, oases) and their identity recovery. */
export const OriginalFeatureSection = ({ selector }: OriginalFeatureSectionProps) => {
  const { view } = useSection(selector.section);
  return (
    <EditorSection info={M.help.originalSources} title={M.sections.originalSources}>
      <AuthoringControls>
        <ListSelect disabled={view.disabled} label={M.fields.originalFeature} options={view.options}
          value={view.choice} onChange={selector.choose} />
        <ActionRow>
          <ActionButton caption={M.captions.selectAtCentre} label={M.actions.selectAtCentre}
            onClick={selector.selectAtCentre} />
          <ActionButton caption={M.captions.next} label={M.actions.nextOriginalSource}
            onClick={selector.selectNext} />
          <ActionButton caption={M.captions.show} label={M.actions.showOriginalSource}
            onClick={selector.showSelected} />
          <ActionButton caption={M.captions.hide} label={M.actions.hideOriginalSource} onClick={selector.hide} />
        </ActionRow>
        <ActionRow>
          <ActionButton caption={M.captions.recoverIdentities} disabled={view.recovering}
            label={M.actions.recoverIdentities} onClick={selector.recover} />
          <ActionButton caption={M.captions.cancelRecovery} label={M.actions.cancelIdentityRecovery}
            onClick={selector.cancelRecovery} />
        </ActionRow>
        <StatusText>{view.status}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};

interface GeneratedContourSectionProps {
  inspector: GeneratedFeatureInspector;
}
/** Measured connected contours of generated or baked terrain (advisory selection). */
export const GeneratedContourSection = ({ inspector }: GeneratedContourSectionProps) => {
  const { field, view } = useSection(inspector.section);
  return (
    <EditorSection info={M.help.contourSelection} title={M.sections.contours}>
      <AuthoringControls>
        <ListSelect label={M.fields.contourKind} options={CONTOUR_KINDS} value={view.kind}
          onChange={inspector.setKind} />
        <NumberField {...field("threshold")} label={M.fields.reliefThreshold} max={64} min={.1} size="narrow"
          step=".1" />
        <ActionRow>
          <ActionButton caption={M.captions.selectAtCentre} disabled={view.busy}
            label={M.actions.selectContourAtCentre} onClick={inspector.inspect} />
          <ActionButton caption={M.captions.clear} label={M.actions.clearContour} onClick={inspector.hide} />
        </ActionRow>
        <StatusText>{view.status}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};

interface ContourTransformProps {
  controls: GeneratedFeatureTransformControls;
}
/** Move / resize of the selected contour (directly in the tab, under the contour selector). */
export const ContourTransformControls = ({ controls }: ContourTransformProps) => {
  const { i18n } = useLingui();
  const { field, view } = useSection(controls.section);
  const riverCourses = translateMessage(i18n, M.fields.includeRiverCourses);
  return (
    <AuthoringControls>
      <NumberField {...field("x")} label={M.fields.moveEast} max={controls.limits.x} min={-controls.limits.x} />
      <NumberField {...field("z")} label={M.fields.moveSouth} max={controls.limits.z} min={-controls.limits.z} />
      <NumberField {...field("size")} label={M.fields.sizePercent} max={200} min={50} size="narrow" />
      <ActionButton caption={M.captions.moveResize} label={M.actions.transformContour}
        onClick={controls.transform} />
      <label className="map-editor__course-toggle">
        <input aria-label={riverCourses} checked={view.includeRivers} type="checkbox"
          onChange={event => controls.setIncludeRivers(event.target.checked)} />
        {` ${riverCourses}`}
      </label>
      <HelpNote>{M.help.contourTransform}</HelpNote>
    </AuthoringControls>
  );
};
