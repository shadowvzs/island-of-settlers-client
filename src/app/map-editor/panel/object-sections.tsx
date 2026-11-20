import type { DecorationEditor } from "../decoration-editor";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import { REGROWTH_SPECIES, type VegetationRegrowthEditor } from "../vegetation-regrowth-editor";
import {
  ActionButton, ActionRow, AuthoringControls, EditorSection, ListSelect, NumberField, StatusText
} from "./fields";
import { useSection } from "./use-section";

interface DecorationSectionProps {
  editor: DecorationEditor;
}
/** Select, move, rotate, scale and remove placed or generated ground decorations (the palette places). */
export const DecorationSection = ({ editor }: DecorationSectionProps) => {
  const { field, view } = useSection(editor.section);
  return (
    <EditorSection info={M.help.decoration} title={M.sections.decoration}>
      <AuthoringControls>
        <NumberField {...field("x")} label={M.fields.decorationX} max={editor.limits.x} min={0} step="any" />
        <NumberField {...field("z")} label={M.fields.decorationZ} max={editor.limits.z} min={0} step="any" />
        <NumberField {...field("rotation")} label={M.fields.decorationRotation} max={360} min={0} size="narrow" />
        <NumberField {...field("scale")} label={M.fields.decorationScale} max={view.scaleMax}
          min={view.scaleMin} size="narrow" step=".01" />
        <ActionRow>
          <ActionButton caption={M.captions.select} label={M.actions.selectDecoration} pressed={view.selectActive}
            onClick={editor.selectOnMap} />
          <ActionButton caption={M.captions.moveToClickDecoration} label={M.actions.moveSelectedDecoration}
            pressed={view.moveActive} onClick={editor.moveToClick} />
        </ActionRow>
        <ActionRow>
          <ActionButton caption={M.captions.apply} label={M.actions.applyDecoration}
            onClick={editor.applyTransform} />
          <ActionButton caption={M.captions.remove} label={M.actions.removeDecoration} onClick={editor.remove} />
        </ActionRow>
        <StatusText>{view.status}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};

interface VegetationSectionProps {
  editor: VegetationRegrowthEditor;
}
/** Bounded tree regrowth inside the view-centred brush or the selected contour. */
export const VegetationSection = ({ editor }: VegetationSectionProps) => {
  const { field, view } = useSection(editor.section);
  return (
    <EditorSection info={M.help.vegetation} title={M.sections.vegetation}>
      <AuthoringControls>
        <ListSelect {...field("species")} label={M.fields.species} options={REGROWTH_SPECIES} />
        <NumberField {...field("seed")} label={M.fields.seed} max={0xffffffff} min={0} size="long" />
        <NumberField {...field("density")} label={M.fields.density} max={1} min={0} size="narrow" step=".05" />
        <NumberField {...field("spacing")} label={M.fields.spacing} max={8} min={1.2} size="narrow" step=".05" />
        <ActionRow>
          <ActionButton caption={M.captions.regrowBrush} icon="tree-sapling" label={M.actions.regrowBrush}
            onClick={editor.regrowInBrush} />
          <ActionButton caption={M.captions.regrowContour} icon="tree-sapling"
            label={M.actions.regrowContour} onClick={editor.regrowInContour} />
        </ActionRow>
        <StatusText>{view.status}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};
