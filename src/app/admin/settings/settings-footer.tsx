import type { GameSettingsPresetId } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { AdminIconButton } from "../admin-icon-button";
import type { SaveOutcome } from "./use-game-settings-form";

interface PresetView {
  id: GameSettingsPresetId;
  label: string;
  name: string;
}

interface FooterTexts {
  applies: string;
  reloadLabel: string;
  revision: string;
  saveLabel: string;
  savedText: string;
  unsavedText: string;
}

interface SettingsFooterProps {
  busy: boolean;
  canSave: boolean;
  dirty: boolean;
  issues: readonly string[];
  outcome: SaveOutcome | null;
  presets: readonly PresetView[];
  texts: FooterTexts;
  onPreset: (presetId: GameSettingsPresetId) => void;
  onReload: () => void;
  onSave: () => void;
}
/** Revision line, presets, Save/Reload, the draft's issues and the last save's result. */
export const SettingsFooter = ({
  busy, canSave, dirty, issues, outcome, presets, texts, onPreset, onReload, onSave
}: SettingsFooterProps) => (
  <footer className="admin-settings__footer">
    <div className="admin-settings__footer-row">
      <span className="admin-settings__revision">{texts.revision}</span>
      <span className="admin-settings__presets">
        {presets.map(preset => (
          <button className="admin-window__chip" disabled={busy} key={preset.id} title={preset.label} type="button"
            onClick={() => onPreset(preset.id)}>{preset.name}</button>
        ))}
      </span>
      {dirty && <span className="admin-settings__unsaved">{texts.unsavedText}</span>}
      <AdminIconButton disabled={busy} icon="reload" label={texts.reloadLabel} onClick={onReload} />
      <AdminIconButton disabled={!canSave} icon="save" label={texts.saveLabel} onClick={onSave} />
    </div>
    <p className="admin-settings__note">{texts.applies}</p>
    {issues.length > 0 && (
      <ul className="admin-settings__issues">{issues.map(text => <li key={text}>{text}</li>)}</ul>
    )}
    {outcome?.ok && <p className="admin-settings__saved" role="status">{texts.savedText}</p>}
    {outcome && outcome.messages.length > 0 && (
      <ul className="admin-settings__issues" data-ok={outcome.ok} role="status">
        {outcome.messages.map(text => <li key={text}>{text}</li>)}
      </ul>
    )}
  </footer>
);
