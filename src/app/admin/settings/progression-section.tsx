import { ChoiceSelect, NumberField } from "./choice-select";
import type { RewardsChoice } from "./helpers";
import { SwitchRow } from "./switch-row";
import type { DraftEditors } from "./use-game-settings-tab";
import type { ProgressionView } from "./view-model";

interface ProgressionSectionProps {
  editors: DraftEditors;
  view: ProgressionView;
}
/** Progression: XP, levels (earned / fixed N), talents and rewards (Auto / On / Off). */
export const ProgressionSection = ({ editors, view }: ProgressionSectionProps) => (
  <fieldset className="admin-settings__group">
    <legend>{view.title}</legend>
    {view.switches.map(row => <SwitchRow key={row.key} row={row} onSwitch={editors.onSwitch} />)}
    <div className="admin-settings__inline">
      <ChoiceSelect<"earned" | "fixed"> choices={view.levelChoices} label={view.levelsLabel} selected={view.levels}
        onChange={editors.onLevels} />
      {view.showsFixedLevel && (
        <NumberField label={view.fixedLevelLabel} max={view.maxFixedLevel} min={1} value={view.fixedLevel}
          onChange={editors.onFixedLevel} />
      )}
    </div>
    <ChoiceSelect<RewardsChoice> choices={view.rewardChoices} label={view.rewardsLabel} selected={view.rewards}
      onChange={editors.onRewards} />
  </fieldset>
);
