import { LabelledButton } from "../components/labelled-button";
import { ADMIN_ICONS, type AdminIconName } from "./constants";

interface AdminIconButtonProps {
  disabled?: boolean;
  icon: AdminIconName;
  /** Accessible name and tooltip. */
  label: string;
  onClick: () => void;
}
/** A compact square icon button of the Administration window; its label is the tooltip. */
export const AdminIconButton = ({ disabled, icon, label, onClick }: AdminIconButtonProps) => (
  <LabelledButton className="admin-window__icon-button" disabled={disabled} label={label} onClick={onClick}>
    <img alt="" aria-hidden="true" draggable={false} src={ADMIN_ICONS[icon]} />
  </LabelledButton>
);
