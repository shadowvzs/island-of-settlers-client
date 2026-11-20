import { joinClassNames } from "../../components/helpers";
import { LabelledButton } from "../../components/labelled-button";
import { getActionIcon } from "../panel/action-icons";
import { IconImage } from "../panel/fields";
import { SCRIPT_ICONS, type ScriptIconName } from "./constants";

interface ScriptIconButtonProps {
  className?: string;
  disabled?: boolean;
  icon: ScriptIconName;
  /** Accessible name and tooltip. */
  label: string;
  onClick: () => void;
}
/** A compact square icon button of the Script workspace (the editor's action icons; the label is its tooltip). */
export const ScriptIconButton = ({ className, disabled, icon, label, onClick }: ScriptIconButtonProps) => {
  const image = getActionIcon(SCRIPT_ICONS[icon]);
  return (
    <LabelledButton className={joinClassNames("script-icon-button", className)} disabled={disabled} label={label}
      onClick={onClick}>
      {image && <IconImage icon={{ src: image.src, srcSet: image.srcSet }} />}
    </LabelledButton>
  );
};
