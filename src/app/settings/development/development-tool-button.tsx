import { useLingui } from "@lingui/react";

import { useExternalStore } from "../../components/external-store";
import { IconButton } from "../../components/icon-button";
import { type DevelopmentTool,getToolClassName } from "./helpers";
import { resolveDevelopmentText } from "./messages";

interface DevelopmentToolButtonProps {
  tool: DevelopmentTool;
}
/** A development tool's square icon button; its accessible name is captioned beside it in the grid. */
export const DevelopmentToolButton = ({
  tool: { hasPopup, icon, iconClassName, label, registerButton, sharedIcon, state, onClick }
}: DevelopmentToolButtonProps) => {
  const { active, disabled, title } = useExternalStore(state);
  const { i18n } = useLingui();
  const resolvedLabel = resolveDevelopmentText(i18n, label);
  if (sharedIcon) return (
    <IconButton
      className={getToolClassName(active)}
      disabled={disabled}
      hasPopup={hasPopup}
      icon={sharedIcon}
      label={resolvedLabel}
      pressed={active}
      ref={registerButton}
      title={resolveDevelopmentText(i18n, title)}
      onClick={onClick}
    />
  );
  return (
    <button
      aria-haspopup={hasPopup}
      aria-label={resolvedLabel}
      aria-pressed={active}
      className={getToolClassName(active)}
      disabled={disabled}
      ref={registerButton}
      title={resolveDevelopmentText(i18n, title)}
      type="button"
      onClick={onClick}
    >
      <img alt="" className={iconClassName} height={36} src={icon} width={36} />
    </button>
  );
};
