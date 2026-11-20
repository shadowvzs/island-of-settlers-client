import { MAP_EDITOR_MESSAGES as M } from "../messages";
import { CATAPULT_CREW_ROWS } from "../scenario-catapult-inspector";
import type { ScenarioEditor } from "../scenario-editor";
import { ActionButton, ActionRow, AuthoringControls, EditorSection, NumberField, TextValue } from "./fields";
import { useSection } from "./use-section";

/** Contextual draft for the clicked placed tower; applying uses the existing map history. */
export const CatapultInspector = ({ editor }: { editor: ScenarioEditor }) => {
  const { field, view } = useSection(editor.catapultInspector.section);
  if (!view.visible) return null;
  const defenders = CATAPULT_CREW_ROWS.reduce((sum, row) => sum + (Number(view[row.name]) || 0), 0);
  return <EditorSection info={M.catapultInspector.help} title={M.catapultInspector.title}>
    <AuthoringControls>
      <NumberField {...field("roof")} label={M.catapultInspector.roof} max={2} min={0} required size="narrow" />
      <NumberField {...field("ground")} label={M.catapultInspector.ground} max={6} min={0} required size="narrow" />
      {CATAPULT_CREW_ROWS.map(row => <NumberField {...field(row.name)} key={row.name}
        label={row.label} max={view.capacity} min={0} required size="narrow" />)}
      <p><TextValue value={M.fields.defenders} />: <output>{defenders}</output></p>
      <p><TextValue value={M.catapultInspector.total} />: <output>{Number(view.roof) + Number(view.ground)}</output></p>
      {view.invalid && <p role="alert"><TextValue value={M.catapultInspector.invalid} /></p>}
      <ActionRow>
        <ActionButton label={M.catapultInspector.apply} onClick={() => editor.catapultInspector.apply()} />
        <ActionButton label={M.catapultInspector.cancel} onClick={editor.catapultInspector.cancel} />
      </ActionRow>
    </AuthoringControls>
  </EditorSection>;
};
