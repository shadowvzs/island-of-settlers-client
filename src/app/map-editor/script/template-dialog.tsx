import { ScriptDialog } from "./script-dialog";
import type { ScriptWorkspace } from "./script-workspace";
import { type TemplateDialogView, useTemplateDialog } from "./use-template-dialog";

interface ParamsProps {
  view: TemplateDialogView;
}
/** The selected template's parameters (enemy, family, ware, building, region, goal, count, seconds, board). */
const TemplateParams = ({ view }: ParamsProps) => (
  <div className="script-picker__filters">
    {view.show.faction && (
      <label>{view.factionLabel}<select value={view.params.faction}
        onChange={event => view.onFaction(event.target.value)}>
        {view.factions.map(faction => <option key={faction.key} value={faction.key}>{faction.label}</option>)}
      </select></label>
    )}
    {view.show.family && (
      <label>{view.familyLabel}<select value={view.params.family} onChange={event => view.onFamily(event.target.value)}>
        {view.families.map(family => <option key={family.key} value={family.key}>{family.label}</option>)}
      </select></label>
    )}
    {view.show.ware && (
      <label>{view.wareLabel}<select value={view.params.ware} onChange={event => view.onWare(event.target.value)}>
        {view.wares.map(ware => <option key={ware.key} value={ware.key}>{ware.label}</option>)}
      </select></label>
    )}
    {view.show.building && (
      <label>{view.buildingLabel}<select value={view.params.building}
        onChange={event => view.onBuilding(event.target.value)}>
        {view.buildings.map(building => <option key={building.key} value={building.key}>{building.label}</option>)}
      </select></label>
    )}
    {view.show.goal && (
      <label>{view.goalLabel}<select value={view.params.goal} onChange={event => view.onGoal(event.target.value)}>
        {view.goals.map(goal => <option key={goal.key} value={goal.key}>{goal.label}</option>)}
      </select></label>
    )}
    {view.show.region && (
      <label>{view.regionLabel}<select value={view.params.region ?? ""}
        onChange={event => view.onRegion(event.target.value)}>
        <option value="">{view.newRegionLabel}</option>
        {view.regions.map(region => <option key={region.key} value={region.key}>{region.label}</option>)}
      </select></label>
    )}
    {view.show.count && (
      <label>{view.countLabel}<input className="input-count" defaultValue={view.params.count} min={1} type="number"
        onChange={event => view.onCount(event.target.value)} /></label>
    )}
    {view.show.seconds && (
      <label>{view.secondsLabel}<input className="input-count" defaultValue={view.params.seconds} min={1}
        type="number" onChange={event => view.onSeconds(event.target.value)} /></label>
    )}
    {view.show.board && (
      <label><input checked={view.params.board} type="checkbox"
        onChange={event => view.onBoard(event.target.checked)} />{view.boardLabel}</label>
    )}
  </div>
);

interface TemplateDialogProps {
  workspace: ScriptWorkspace;
  onClose: () => void;
}
/** One click inserts a trigger set with its variables, quest and actors (owner examples), then edit it. */
export const TemplateDialog = ({ workspace, onClose }: TemplateDialogProps) => {
  const view = useTemplateDialog(workspace, onClose);
  const footer = (
    <>
      <button type="button" onClick={view.onClose}>{view.cancelLabel}</button>
      <button className="script-dialog__primary" type="button" onClick={view.onInsert}>{view.insertLabel}</button>
    </>
  );
  return (
    <ScriptDialog closeLabel={view.cancelLabel} footer={footer} title={view.title} onClose={view.onClose}>
      <ul className="script-templates">
        {view.templates.map(template => (
          <li key={template.id}>
            <button aria-pressed={template.selected} type="button" onClick={() => view.onSelect(template.id)}>
              <strong>{template.name}</strong>
              <span>{template.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <TemplateParams view={view} />
    </ScriptDialog>
  );
};
