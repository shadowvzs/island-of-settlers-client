import { INPUT_SIZE_CLASSES } from "../../../components/input-sizes";
import { RewardIcons } from "../../../settlement-ui/reward-icons/reward-icons";
import { RewardPicker } from "../../reward-picker/reward-picker";
import { RuleIconButton } from "../rule-icon-button";
import { FACTION_AI_PICKER_COPY, FACTION_AI_START_TABS } from "./constants";
import type { FactionAiRowSectionView, FactionAiSectionView } from "./use-faction-ai";
import type { FactionAiChoiceView, FactionAiNumberView } from "./view-model";

interface ChoiceGroupProps {
  choices: readonly FactionAiChoiceView<string>[];
  onPick: (id: string) => void;
}
/** A pressed group of icon buttons (one choice is pressed). */
const ChoiceGroup = ({ choices, onPick }: ChoiceGroupProps) => (
  <span className="faction-ai__choices" role="group">
    {choices.map(choice => <RuleIconButton className="faction-ai__choice" disabled={choice.disabled}
      icon={choice.icon} key={choice.id} label={choice.label} pressed={choice.pressed}
      onClick={() => onPick(choice.id)} />)}
  </span>
);

interface NumberFieldProps {
  field: FactionAiNumberView<string>;
  onCommit: (id: string, text: string) => void;
}
/** Commits on blur; empty text removes the value. */
const NumberField = ({ field, onCommit }: NumberFieldProps) => (
  <label className="faction-ai__number" title={field.hint}>
    <span>{field.label}</span>
    <input className={INPUT_SIZE_CLASSES.narrow} defaultValue={field.text} key={field.text} max={field.max}
      min={field.min} placeholder={field.placeholder} type="number"
      onBlur={event => onCommit(field.id, event.target.value)} />
  </label>
);

interface NumberRowProps {
  fields: readonly FactionAiNumberView<string>[];
  title: string;
  onCommit: (id: string, text: string) => void;
}
const NumberRow = ({ fields, title, onCommit }: NumberRowProps) => (
  <div className="map-rules__row">
    <span className="faction-ai__field-title">{title}</span>
    {fields.map(field => <NumberField field={field} key={field.id} onCommit={onCommit} />)}
  </div>
);

interface FactionAiRowProps {
  row: FactionAiRowSectionView;
  view: FactionAiSectionView;
}
/** The depot start picker, the bonus and the limits of an AI-played faction. */
const FactionAiDetails = ({ row, view }: FactionAiRowProps) => {
  const { details, faction } = row;
  if (!details) return null;
  return (
    <details className="faction-ai__details">
      <summary title={details.label}>
        {row.depotSummary.hasRewards && <RewardIcons view={row.depotSummary} />}
        {!row.depotSummary.hasRewards && <span className="faction-ai__empty">{details.depotEmpty}</span>}
      </summary>
      <RewardPicker copy={FACTION_AI_PICKER_COPY} entries={details.entries} idPrefix={`faction-ai-${faction}`}
        nation={row.nation} tabs={FACTION_AI_START_TABS} onChange={entries => view.onStartChange(faction, entries)} />
      <NumberRow fields={details.bonus} title={details.bonusTitle}
        onCommit={(id, text) => view.onBonusCommit(faction, id, text)} />
      <NumberRow fields={details.limits} title={details.limitsTitle}
        onCommit={(id, text) => view.onLimitCommit(faction, id, text)} />
    </details>
  );
};

/** One faction: chip, mode group, style group, level, handicap badge, then the details expander. */
const FactionAiRow = ({ row, view }: FactionAiRowProps) => (
  <li className="faction-ai__row">
    <div className="map-rules__row">
      <span className="faction-ai__chip" title={row.chipLabel}>{row.chip}</span>
      <ChoiceGroup choices={row.modes} onPick={id => view.onModeChange(row.faction, id)} />
      <ChoiceGroup choices={row.styles} onPick={id => view.onStyleChange(row.faction, id)} />
      <select aria-label={row.level.label} className={INPUT_SIZE_CLASSES.short} disabled={row.level.disabled}
        title={row.level.label} value={row.level.value}
        onChange={event => view.onLevelChange(row.faction, event.target.value)}>
        {row.level.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {row.handicap && <span className="map-rules__badge" data-tone="handicap">{row.handicap}</span>}
    </div>
    <FactionAiDetails row={row} view={view} />
  </li>
);

interface FactionAiGroupProps {
  view: FactionAiSectionView;
}
/** The "Computer factions" rows of the Map rules section (enemy economy AI plan §2.3); hidden on a home map. */
export const FactionAiGroup = ({ view }: FactionAiGroupProps) => {
  if (!view.shown) return null;
  return (
    <div className="faction-ai">
      <div className="map-rules__row">
        <span className="map-rules__label" title={view.titleHint}>{view.title}</span>
        <RuleIconButton disabled={view.addDisabled} icon="action:build" label={view.addLabel} onClick={view.onAdd} />
        {view.pendingNote && (
          <span className="map-rules__badge" data-tone="pending" title={view.pendingHint}>{view.pendingNote}</span>
        )}
      </div>
      <ul className="faction-ai__rows">
        {view.rows.map(row => <FactionAiRow key={row.faction} row={row} view={view} />)}
      </ul>
    </div>
  );
};
