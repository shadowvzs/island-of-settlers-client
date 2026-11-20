import type { TitleScreenFiles } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { BooleanSettingKey } from "./helpers";
import { SwitchRow } from "./switch-row";
import type { TitleFileFieldView, TitlePageView } from "./view-model";

interface TitleFileFieldProps {
  view: TitleFileFieldView;
  onChange: (field: keyof TitleScreenFiles, value: string) => void;
}
const TitleFileField = ({ view, onChange }: TitleFileFieldProps) => (
  <label className="admin-settings__field admin-settings__field--file" title={view.hint}>
    <span>{view.label}</span>
    <input aria-invalid={Boolean(view.error)} maxLength={view.maxLength} placeholder={view.placeholder}
      spellCheck={false} type="text" value={view.value} onChange={event => onChange(view.field, event.target.value)} />
    {view.error && <span className="admin-settings__field-error">{view.error}</span>}
  </label>
);

interface TitlePageSectionProps {
  view: TitlePageView;
  onSwitch: (key: BooleanSettingKey, value: boolean) => void;
  onTitleFile: (field: keyof TitleScreenFiles, value: string) => void;
}
/**
 * Title page: the "game menu before play" switch (owner 2026-11-13) and the files, names only, always inside the
 * build's `title/` folder (owner 2026-11-12).
 */
export const TitlePageSection = ({ view, onSwitch, onTitleFile }: TitlePageSectionProps) => (
  <fieldset className="admin-settings__group">
    <legend>{view.title}</legend>
    <SwitchRow row={view.menuBeforePlay} onSwitch={onSwitch} />
    {view.fields.map(field => <TitleFileField key={field.field} view={field} onChange={onTitleFile} />)}
  </fieldset>
);
