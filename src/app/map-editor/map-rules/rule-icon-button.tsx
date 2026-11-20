import { joinClassNames } from "../../components/helpers";
import { LabelledButton } from "../../components/labelled-button";
import { getActionIcon } from "../panel/action-icons";
import { IconImage } from "../panel/fields";

interface RuleIconButtonProps {
  className?: string;
  disabled?: boolean;
  icon: string;
  label: string;
  pressed?: boolean;
  onClick: () => void;
}
/** A compact square icon button; the label is its tooltip and accessible name. */
export const RuleIconButton = ({ className, disabled, icon, label, pressed, onClick }: RuleIconButtonProps) => {
  const image = getActionIcon(icon);
  return (
    <LabelledButton className={joinClassNames("map-rules__button", className)} disabled={disabled} label={label}
      pressed={pressed} onClick={onClick}>
      {image && <IconImage icon={{ src: image.src, srcSet: image.srcSet }} />}
    </LabelledButton>
  );
};
