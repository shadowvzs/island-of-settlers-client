import { MAP_EDITOR_MESSAGES as M } from "../messages";
import type { RiverEditor } from "../river-editor";
import type { TerrainFeatureEditor } from "../terrain-feature-editor";
import {
  ActionButton, ActionRow, AuthoringControls, EditorSection, ListSelect, NumberField, StatusText
} from "./fields";
import { useSection } from "./use-section";

interface TerrainFeatureSectionProps {
  editor: TerrainFeatureEditor;
}
/** Editor-authored mountains and lakes: move, resize, remove. */
export const TerrainFeatureSection = ({ editor }: TerrainFeatureSectionProps) => {
  const { field, view } = useSection(editor.section);
  return (
    <EditorSection info={M.help.riverFeatures} title={M.sections.terrainFeatures}>
      <AuthoringControls>
        <ListSelect label={M.fields.authoredFeature} options={view.options} value={view.selected}
          onChange={editor.select} />
        <NumberField {...field("x")} label={M.fields.featureX} max={editor.limits.x} min={0} step="any" />
        <NumberField {...field("z")} label={M.fields.featureZ} max={editor.limits.z} min={0} step="any" />
        <NumberField {...field("level")} label={M.fields.featureLevel} max={view.levelMax} min={1} size="narrow" />
        <ActionRow>
          <ActionButton caption={M.captions.apply} label={M.actions.applyFeature} onClick={editor.apply} />
          <ActionButton caption={M.captions.remove} label={M.actions.removeFeature} onClick={editor.remove} />
          <ActionButton caption={M.captions.refreshList} label={M.actions.refreshFeatures}
            onClick={editor.refresh} />
          <ActionButton caption={M.captions.retryRebuild} label={M.actions.retryRebuild}
            onClick={editor.retryRebuild} />
        </ActionRow>
        <StatusText>{view.details}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};

interface RiverSectionProps {
  editor: RiverEditor;
}
/** Connected rivers: draw, adopt, select, resize, move endpoints, erase and remove. */
export const RiverSection = ({ editor }: RiverSectionProps) => {
  const { field, view } = useSection(editor.section);
  return (
    <EditorSection info={M.help.river} title={M.sections.connectedRivers}>
      <AuthoringControls>
        <NumberField {...field("width")} ariaLabel={M.fields.riverWidth} label={view.widthLabel}
          max={view.widthMax} min={view.widthMin} required size="narrow" step={view.step} />
        <NumberField {...field("depth")} ariaLabel={M.fields.riverDepth} label={view.depthLabel}
          max={view.depthMax} min={view.depthMin} required size="narrow" step={view.step} />
        <ActionRow>
          <ActionButton caption={M.captions.drawRiver} label={M.actions.drawConnectedRiver}
            pressed={view.drawPressed} onClick={editor.drawRiver} />
          <ActionButton caption={M.captions.traceBakedRiver} icon="action:scout"
            label={M.actions.traceBakedRiver} pressed={view.adoptPressed} onClick={editor.adoptBaked} />
          <ActionButton caption={M.captions.eraseAtClick} label={M.actions.eraseRiverAtClick}
            pressed={view.erasePressed} onClick={editor.eraseAtClick} />
        </ActionRow>
        <ListSelect disabled={view.listDisabled} label={M.fields.editableRiver} options={view.options}
          value={view.selected} onChange={editor.select} />
        <ActionRow>
          <ActionButton caption={M.captions.applySize} disabled={view.selectionDisabled}
            label={M.actions.applyRiverSize} onClick={editor.applyDimensions} />
          <ActionButton caption={M.captions.moveSource} disabled={view.selectionDisabled}
            label={M.actions.moveRiverSource} pressed={view.sourcePressed} onClick={editor.moveSource} />
          <ActionButton caption={M.captions.moveMouth} disabled={view.selectionDisabled}
            label={M.actions.moveRiverMouth} pressed={view.mouthPressed} onClick={editor.moveMouth} />
          <ActionButton caption={M.captions.remove} disabled={view.selectionDisabled}
            label={M.actions.removeSelectedRiver} onClick={editor.removeSelected} />
        </ActionRow>
      </AuthoringControls>
    </EditorSection>
  );
};
