import { INPUT_SIZE_CLASSES } from "../../components/input-sizes";
import { RewardIcons } from "../../settlement-ui/reward-icons/reward-icons";
import { EditorSection } from "../panel/fields";
import { RewardPicker } from "../reward-picker/reward-picker";
import { START_SETUP_PICKER_COPY, START_SETUP_TABS } from "./constants";
import type { EditorModeView } from "./editor-mode";
import { FactionAiGroup } from "./faction-ai/faction-ai-rows";
import type { MapRulesControls } from "./map-rules-controls";
import { RuleIconButton } from "./rule-icon-button";
import { useMapRules } from "./use-map-rules";
import type { MapRuleToggleView } from "./view-model";

import "./map-rules.css";

interface RuleToggleProps {
  toggle: MapRuleToggleView;
  onToggle: (id: string) => void;
}
/** Pressed = switched off on this map (struck through). */
const RuleToggle = ({ toggle, onToggle }: RuleToggleProps) => (
  <RuleIconButton className="map-rules__toggle" disabled={toggle.disabled} icon={toggle.icon} label={toggle.label}
    pressed={toggle.pressed} onClick={() => onToggle(toggle.id)} />
);

interface EditorModeLineProps {
  mode: EditorModeView;
}
/** The game mode the editor follows: mode, reward scope and a "not loaded" badge until the settings arrived. */
const EditorModeLine = ({ mode }: EditorModeLineProps) => (
  <p className="map-rules__mode" title={mode.source}>
    <span>{mode.mode}</span>
    <span className="map-rules__badge" title={mode.rewardsHint}>{mode.rewards}</span>
    {mode.notLoaded && <span className="map-rules__badge" data-tone="pending">{mode.notLoaded}</span>}
  </p>
);

interface MapRulesSectionProps {
  controls: MapRulesControls;
}
/** The map file's start setup and its narrowing rules (plan §13.2, compact). */
export const MapRulesSection = ({ controls }: MapRulesSectionProps) => {
  const view = useMapRules(controls);
  const { level, mode, start } = view;
  return (
    <EditorSection info={mode.source} title={view.title}>
      <div className="map-rules">
        <EditorModeLine mode={mode} />
        <div className="map-rules__row">
          <span className="map-rules__label">{start.title}</span>
          {start.toggle && <RuleToggle toggle={start.toggle} onToggle={view.onStartSetupToggle} />}
          <RuleIconButton disabled={!start.pickerShown} icon="camera:reset" label={start.nationDefaultLabel}
            onClick={view.onNationDefault} />
          {start.nationDefaultBadge && <span className="map-rules__badge">{start.nationDefaultBadge}</span>}
        </div>
        {start.expeditionNote && <p className="map-editor__note">{start.expeditionNote}</p>}
        {start.pickerShown && (
          <details className="map-rules__start">
            <summary title={start.editLabel}><RewardIcons view={view.summary} /></summary>
            <RewardPicker copy={START_SETUP_PICKER_COPY} entries={view.entries} idPrefix="map-rules-start"
              nation={view.nation} tabs={START_SETUP_TABS} onChange={view.onStartEntriesChange} />
          </details>
        )}
        <div className="map-rules__row">
          <span className="map-rules__label">{view.rulesTitle}</span>
          {view.features.map(toggle => <RuleToggle key={toggle.id} toggle={toggle} onToggle={view.onFeatureToggle} />)}
          {view.progression.map(toggle => <RuleToggle key={toggle.id} toggle={toggle}
            onToggle={view.onProgressionToggle} />)}
          <label className="map-rules__level" title={level.hint}>
            <span>{level.label}</span>
            <input className={INPUT_SIZE_CLASSES.narrow} defaultValue={level.text} disabled={level.disabled}
              key={level.text} max={level.max} min={level.min} type="number"
              onBlur={event => view.onLevelCommit(event.target.value)} />
          </label>
        </div>
        {view.gameBadges.length > 0 && (
          <div className="map-rules__row">
            {view.gameBadges.map(badge => <span className="map-rules__badge" key={badge}>{badge}</span>)}
          </div>
        )}
        <FactionAiGroup view={view.factionAi} />
        {view.validation.length > 0 && (
          <ul className="map-rules__warnings">
            {view.validation.map(line => (
              <li data-severity={line.severity} key={line.key} role="alert">{line.text}</li>
            ))}
          </ul>
        )}
      </div>
    </EditorSection>
  );
};
