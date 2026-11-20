import type { GameSettings } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { ChoiceSelect, NumberField } from "./choice-select";
import { SwitchRow } from "./switch-row";
import type { DraftEditors } from "./use-game-settings-tab";
import type { PlayView } from "./view-model";

interface PlaySectionProps {
  editors: DraftEditors;
  view: PlayView;
}
/** Play: own home island, mode, automatic saving (+ minutes), Save/Load slots and the landing after a map. */
export const PlaySection = ({ editors, view }: PlaySectionProps) => (
  <fieldset className="admin-settings__group">
    <legend>{view.title}</legend>
    <SwitchRow row={view.home} onSwitch={editors.onSwitch} />
    <div className="admin-settings__inline">
      <ChoiceSelect<GameSettings["connectivity"]> choices={view.modeChoices} label={view.modeLabel}
        selected={view.connectivity} onChange={editors.onConnectivity} />
      <span className="admin-settings__note">{view.catchUpNote}</span>
    </div>
    <SwitchRow row={view.autosave} onSwitch={editors.onSwitch} />
    {view.showsAutosaveMinutes && (
      <NumberField label={view.autosaveMinutesLabel} max={view.autosaveMinutesLimits.max}
        min={view.autosaveMinutesLimits.min} value={view.autosaveMinutes} onChange={editors.onAutosaveMinutes} />
    )}
    <SwitchRow row={view.slots} onSwitch={editors.onSwitch} />
    <ChoiceSelect<GameSettings["afterMap"]> choices={view.afterMapChoices} label={view.afterMapLabel}
      selected={view.afterMap} onChange={editors.onAfterMap} />
  </fieldset>
);
