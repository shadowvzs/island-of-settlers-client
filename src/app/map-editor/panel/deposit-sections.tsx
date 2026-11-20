import { useLingui } from "@lingui/react";

import { MARBLE_DEPOSIT_QUANTITY, STONE_SOURCE_REST_SECONDS } from "../../../shared/balance/resources";
import { MAX_MARBLE_DEPOSITS } from "../../../shared/world/marble-deposit";
import { PROP } from "../../../shared/world/world-data";
import { DOODAD_CHOICES } from "../editor-catalog";
import type { EditorStore } from "../editor-store";
import type { FishingWaterEditor } from "../fishing-water-editor";
import type { MarbleEditor } from "../marble-editor";
import { MARBLE_MATERIALS } from "../marble-editor";
import { editorMessage, MAP_EDITOR_MESSAGES as M, resolveEditorText } from "../messages";
import type { OreEditor } from "../ore-editor";
import {
  ActionButton, ActionRow, AuthoringControls, ChoiceField, EditorSection, HelpNote, ListSelect, NumberField, StatusText
} from "./fields";
import { toChoiceSpecs } from "./helpers";
import { ToolGrid } from "./tool-grid";
import { useMaterialRows } from "./use-editor-store";
import { useSection } from "./use-section";

const QUARRY_STONE_SPECS = toChoiceSpecs("stone", DOODAD_CHOICES.filter(choice => choice.value === PROP.largeRock))
  .map(spec => ({ ...spec, action: { ...spec.action, message: M.catalog.tool.quarryStoneBoulder } }));
const MATERIAL_OPTIONS = MARBLE_MATERIALS.map(({ label, value }) => ({ label, value }));
const RESPAWN_MINUTES = STONE_SOURCE_REST_SECONDS / 60;
const PLACE_HELP = editorMessage(M.help.placeDeposit, { minutes: RESPAWN_MINUTES });
const MARBLE_HELP = editorMessage(M.help.marble, {
  deposits: MAX_MARBLE_DEPOSITS,
  minutes: RESPAWN_MINUTES,
  quantity: MARBLE_DEPOSIT_QUANTITY
});

interface StoneDepositSectionProps {
  editor: MarbleEditor;
  store: EditorStore;
}
/** One palette for every stone deposit (select type, click the map) and the placed material deposits. */
export const StoneDepositSection = ({ editor, store }: StoneDepositSectionProps) => {
  const { i18n } = useLingui();
  const { field, view } = useSection(editor.section);
  const materials = useMaterialRows(store);
  return (
    <EditorSection info={PLACE_HELP} title={M.sections.stone}>
      <ToolGrid specs={QUARRY_STONE_SPECS} store={store}>
        {materials.map(material => {
          const title = resolveEditorText(i18n, material.title);
          return (
            <button aria-label={title} aria-pressed={material.pressed} className={material.className}
              key={material.value} title={title} type="button" onClick={() => editor.pick(material.value)}>
              <img alt={resolveEditorText(i18n, material.label)} className="map-editor__material-icon"
                src={material.icon} />
            </button>
          );
        })}
      </ToolGrid>
      <AuthoringControls>
        <NumberField {...field("quantity")} label={M.fields.depositAmount} max={MARBLE_DEPOSIT_QUANTITY} min={0}
          required step="1" />
        <ListSelect label={M.fields.placedDeposit} options={view.options} value={view.selected}
          onChange={editor.select} />
        <ChoiceField {...field("material")} label={M.fields.depositMaterial} options={MATERIAL_OPTIONS} />
        <NumberField {...field("x")} label={M.fields.depositX} max={editor.limits.x} min={1} required step=".5" />
        <NumberField {...field("z")} label={M.fields.depositZ} max={editor.limits.z} min={1} required step=".5" />
        <ActionRow>
          <ActionButton caption={M.captions.setAmount} label={M.actions.applyDepositAmount}
            onClick={editor.applyQuantity} />
          <ActionButton caption={M.captions.setMaterial} label={M.actions.applyDepositMaterial}
            onClick={editor.applyMaterial} />
          <ActionButton caption={M.captions.move} label={M.actions.moveDeposit} onClick={editor.move} />
          <ActionButton caption={M.captions.remove} label={M.actions.removeDeposit} onClick={editor.remove} />
        </ActionRow>
        <HelpNote>{MARBLE_HELP}</HelpNote>
      </AuthoringControls>
    </EditorSection>
  );
};

interface OreSectionProps {
  editor: OreEditor;
}
/** Remaining ore of painted deposits: per cell or an exact total. */
export const OreSection = ({ editor }: OreSectionProps) => {
  const { field, view } = useSection(editor.section);
  return (
    <EditorSection info={M.help.ore} title={M.sections.ore}>
      <AuthoringControls>
        <ListSelect label={M.fields.quantityOption} options={view.options} value={view.selected}
          onChange={editor.select} />
        <NumberField {...field("each")} label={M.fields.orePerCell} max={255} min={0} size="narrow" />
        <NumberField {...field("total")} label={M.fields.oreTotal} max={view.totalMax} min={0} />
        <ActionRow>
          <ActionButton caption={M.captions.setOrePerCell} label={M.actions.setOrePerCell}
            onClick={editor.setPerCell} />
          <ActionButton caption={M.captions.setOreTotal} label={M.actions.setOreTotal} onClick={editor.setTotal} />
          <ActionButton caption={M.captions.refresh} label={M.actions.refreshOre} onClick={editor.refresh} />
        </ActionRow>
        <StatusText>{view.status}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};

interface FishingSectionProps {
  editor: FishingWaterEditor;
}
/** Fishable water: shape lake / sea habitat and inspect real shore casts near the view centre. */
export const FishingSection = ({ editor }: FishingSectionProps) => {
  const { view } = useSection(editor.section);
  return (
    <EditorSection info={M.help.fishing} title={M.sections.fish}>
      <ActionRow>
        <ActionButton caption={M.captions.lakeHabitat} icon="relief-lake" label={M.actions.shapeFishingLake}
          onClick={editor.shapeLake} />
        <ActionButton caption={M.captions.seaHabitat} icon="terrain-sea" label={M.actions.shapeFishingSea}
          onClick={editor.shapeSea} />
        <ActionButton caption={M.captions.inspectShore} disabled={view.busy}
          label={M.actions.inspectFishingShore} onClick={editor.inspect} />
      </ActionRow>
      <StatusText className="map-editor__note">{view.status}</StatusText>
    </EditorSection>
  );
};
