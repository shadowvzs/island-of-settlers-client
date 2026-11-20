import type { Ref } from "react";

interface SettingsButtonProps {
  /** While set the button is disabled and shows this working label ("Saving…"). */
  busyLabel?: string | null;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  label: string;
  type?: "button" | "submit";
  onClick?: () => void;
}
/** A Settings > Account button in the settings skin. */
export const SettingsButton = ({
  busyLabel = null, buttonRef, disabled = false, label, type = "button", onClick
}: SettingsButtonProps) => (
  <button
    className="account-settings__button"
    disabled={disabled || busyLabel !== null}
    ref={buttonRef}
    type={type}
    onClick={onClick}
  >
    {busyLabel ?? label}
  </button>
);
