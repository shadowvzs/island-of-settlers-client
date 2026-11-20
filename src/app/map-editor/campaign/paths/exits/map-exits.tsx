import type { CampaignMap } from "../../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignEditor } from "../../campaign-editor";
import { TranslationField } from "../../translation/translation-field";
import { PathIcon } from "../path-icons";
import { useMapExits } from "./use-map-exits";

import "../campaign-paths.css";

type MapExitsView = ReturnType<typeof useMapExits>;
type ExitRowView = MapExitsView["rows"][number];

interface ExitTargetsProps {
  row: ExitRowView;
  view: MapExitsView;
}
/** "Leads to": one compact toggle per listed map and the campaign end. */
const ExitTargets = ({ row, view }: ExitTargetsProps) => (
  <fieldset className="campaign-paths__targets">
    <legend>{view.leadsToLabel}</legend>
    {row.targets.map(target => (
      <label className="campaign-paths__target" data-end={target.to === null} key={target.key}>
        <input checked={target.checked} disabled={target.disabled} type="checkbox"
          onChange={event => view.onTargetChange({ exit: row.id, to: target.to }, event.target.checked)} />
        <span>{target.label}</span>
      </label>
    ))}
  </fieldset>
);

interface ExitRowProps {
  row: ExitRowView;
  view: MapExitsView;
}
/** One exit: name (the victory exit has a fixed label), epilogue picker, delete, then its targets. */
const ExitRow = ({ row, view }: ExitRowProps) => (
  <li className="campaign-paths__exit" data-exit={row.id}>
    <div className="campaign-paths__exit-head">
      {!row.name && <strong className="campaign-paths__default-exit">{view.defaultLabel}</strong>}
      {row.name && <TranslationField label={view.exitNameLabel} text={row.name}
        onChange={name => view.onNameChange(row.id, name)} />}
      {row.sequence && (
        <label className="campaign-editor__label campaign-paths__sequence">
          <span>{view.epilogueLabel}</span>
          <select value={row.sequenceId} onChange={event => view.onSequenceChange(row.id, event.target.value)}>
            {row.sequence.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      )}
      {row.name && (
        <span className="campaign-paths__delete" title={row.deleteTitle}>
          <button aria-label={row.deleteLabel} className="campaign-editor__icon-button" disabled={!row.deletable}
            title={row.deleteTitle} type="button" onClick={() => view.onDelete(row.id)}>
            <PathIcon name="delete" />
          </button>
        </span>
      )}
    </div>
    <ExitTargets row={row} view={view} />
  </li>
);

interface MapExitsProps {
  editor: CampaignEditor;
  map: CampaignMap;
}
/** The selected map's exits and where each leads (BR3; the visual graph editor is phase 2). */
export const MapExits = ({ editor, map }: MapExitsProps) => {
  const view = useMapExits(editor, map);
  return (
    <section aria-label={view.title} className="campaign-paths">
      <div className="campaign-paths__bar">
        <h4>{view.title}</h4>
        <button aria-label={view.addLabel} className="campaign-editor__icon-button" disabled={view.addDisabled}
          title={view.addLabel} type="button" onClick={view.onAdd}>
          <PathIcon name="add" />
        </button>
      </div>
      {view.lockNote && (
        <p className="campaign-paths__lock">
          <span>{view.lockNote}</span>
          <button aria-label={view.removeLockLabel} className="campaign-editor__icon-button"
            title={view.removeLockLabel} type="button" onClick={view.onRemoveLock}>
            <PathIcon name="unlock" />
          </button>
        </p>
      )}
      <ul className="campaign-paths__exits">
        {view.rows.map(row => <ExitRow key={row.id} row={row} view={view} />)}
      </ul>
    </section>
  );
};
