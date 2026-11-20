import type { CampaignEditor } from "../../campaign-editor";
import { PathIcon } from "../path-icons";
import { useStartMaps } from "./use-start-maps";

import "../campaign-paths.css";

interface StartMapsProps {
  editor: CampaignEditor;
}
/** Details tab: the maps available when the campaign begins, and the "Make linear" helper. */
export const StartMaps = ({ editor }: StartMapsProps) => {
  const view = useStartMaps(editor);
  return (
    <section aria-label={view.title} className="campaign-paths">
      <div className="campaign-paths__bar">
        <h4>{view.title}</h4>
        {view.linearBadge && <span className="campaign-editor__badge">{view.linearBadge}</span>}
        <button aria-label={view.linearLabel} className="campaign-editor__icon-button" title={view.linearLabel}
          type="button" onClick={view.onMakeLinear}>
          <PathIcon name="linear" />
        </button>
      </div>
      <fieldset aria-label={view.title} className="campaign-paths__targets">
        {view.choices.map(choice => (
          <label className="campaign-paths__target" key={choice.id}>
            <input checked={choice.checked} type="checkbox"
              onChange={event => view.onStartChange(choice.id, event.target.checked)} />
            <span>{choice.name}</span>
          </label>
        ))}
      </fieldset>
      <p className="campaign-editor__hint">{view.note}</p>
    </section>
  );
};
