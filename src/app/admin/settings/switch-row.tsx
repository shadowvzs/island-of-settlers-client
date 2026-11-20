import type { BooleanSettingKey } from "./helpers";
import type { SwitchRowView } from "./view-model";

interface SwitchRowProps {
  row: SwitchRowView;
  onSwitch: (key: BooleanSettingKey, value: boolean) => void;
}
/**
 * One flat switch; a disabled one shows its forced/unavailable value and the dependency reason (tooltip + note), an
 * enabled one its hint as the tooltip.
 */
export const SwitchRow = ({ row, onSwitch }: SwitchRowProps) => (
  <label className="admin-settings__switch" data-setting={row.key} title={row.reason || row.hint}>
    <input checked={row.checked} disabled={row.disabled} type="checkbox"
      onChange={event => onSwitch(row.key, event.target.checked)} />
    <span className="admin-settings__switch-label">{row.label}</span>
    {row.reason && <span className="admin-settings__reason">{row.reason}</span>}
  </label>
);

interface SwitchGroupProps {
  rows: readonly SwitchRowView[];
  title: string;
  onSwitch: (key: BooleanSettingKey, value: boolean) => void;
}
/** A titled group of flat switches (Features, Online). */
export const SwitchGroup = ({ rows, title, onSwitch }: SwitchGroupProps) => (
  <fieldset className="admin-settings__group">
    <legend>{title}</legend>
    {rows.map(row => <SwitchRow key={row.key} row={row} onSwitch={onSwitch} />)}
  </fieldset>
);
