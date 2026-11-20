import { AudioPanel } from "./audio-panel";
import { CatalogPanel, ChoiceList, FamilyPanel, FilterBar, RewardLines, ValueInput } from "./picker-panels";
import { ScriptDialog } from "./script-dialog";
import type { ScriptWorkspace } from "./script-workspace";
import type { PickerRequest } from "./use-script-dialogs";
import { type SlotPickerView, useSlotPicker } from "./use-slot-picker";

const ID_PREFIX = "script-picker";

interface ActivePanelProps {
  view: SlotPickerView;
  workspace: ScriptWorkspace;
}
const ActivePanel = ({ view, workspace }: ActivePanelProps) => {
  const { spec, tab, value } = view;
  if (spec.kind === "audio") return <AudioPanel kind={spec.audio} value={value} workspace={workspace}
    onChoose={view.onChoose} />;
  if (tab === "type") return <CatalogPanel filters={view.filters} idPrefix={`${ID_PREFIX}-catalog`} spec={spec}
    value={value} onChoose={view.onChoose} />;
  if (tab === "family") return <FamilyPanel spec={spec} value={value} view={view} />;
  if (tab === "value" || tab === "math") return <ValueInput chooseLabel={view.chooseLabel} math={tab === "math"}
    spec={spec} value={value} onChoose={view.onChoose} />;
  if (tab === "rewards" || tab === "goods" || tab === "soldiers") return <RewardLines chooseLabel={view.chooseLabel}
    idPrefix={`${ID_PREFIX}-rewards`} kind={tab} value={value} onChoose={view.onChoose} />;
  return <ChoiceList view={view} />;
};

interface SlotPickerFooterProps {
  view: SlotPickerView;
}
const SlotPickerFooter = ({ view }: SlotPickerFooterProps) => (
  <>
    {view.pickObject && <button type="button" onClick={view.onPickObject}>{view.pickObjectLabel}</button>}
    {view.pickRegion && <button type="button" onClick={view.onPickRegion}>{view.pickObjectLabel}</button>}
    {view.optional && <button type="button" onClick={view.onClear}>{view.clearLabel}</button>}
    <button type="button" onClick={view.onClose}>{view.cancelLabel}</button>
  </>
);

interface SlotPickerProps {
  request: PickerRequest;
  workspace: ScriptWorkspace;
  onClose: () => void;
}
/**
 * The typed slot picker (design §13.3): tabs of the slot's value kinds (an actor, a type, a family, from the event,
 * loop item, value, variable, function, math), only values of the slot type, pick on map for objects and regions.
 */
export const SlotPicker = ({ request, workspace, onClose }: SlotPickerProps) => {
  const view = useSlotPicker(workspace, request, onClose);
  return (
    <ScriptDialog closeLabel={view.cancelLabel} footer={<SlotPickerFooter view={view} />} title={view.title}
      onClose={view.onClose}>
      {view.tabs.length > 1 && (
        <div aria-label={view.tabsLabel} className="script-picker__tabs" role="tablist">
          {view.tabs.map(tab => (
            <button aria-selected={tab.selected} key={tab.id} role="tab" type="button"
              onClick={() => view.onTab(tab.id)}>{tab.label}</button>
          ))}
        </div>
      )}
      {view.filtered && <FilterBar view={view} />}
      <div className="script-picker__panel" role="tabpanel"><ActivePanel key={view.tab} view={view} workspace={workspace} /></div>
    </ScriptDialog>
  );
};
