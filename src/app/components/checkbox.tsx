import { type InfoContent, InlineInfo } from "./info-hint";

interface CheckboxProps {
  checked: boolean;
  disabled?: boolean;
  info?: InfoContent;
  label: string;
  title?: string;
  onChange: (checked: boolean) => void;
}
/** Paper checkbox setting, with an optional blue info button beside it. */
export const Checkbox = ({ checked, disabled, info, label, title, onChange }: CheckboxProps) => {
  const checkbox = (
    <label className="settings-panel__check" title={title}>
      <input checked={checked} disabled={disabled} type="checkbox" onChange={event => onChange(event.target.checked)} />
      <span className="settings-panel__check-text">{label}</span>
    </label>
  );
  if (!info) return checkbox;
  return (
    <div className="settings-panel__control-row">
      {checkbox}
      <InlineInfo info={info} />
    </div>
  );
};
