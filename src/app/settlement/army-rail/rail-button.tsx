import type { ReactNode, Ref } from "react";

import { LabelledButton } from "../../components/labelled-button";

interface RailButtonProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  expanded?: boolean;
  hidden?: boolean;
  label: string;
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
  title?: string;
  onClick: () => void;
}
/** A square icon button of the soldier rail; the label is its accessible name and default tooltip. */
export const RailButton = ({
  children, className = "army-action-rail__button settlement-ui__button", disabled, expanded, hidden, label,
  pressed, ref, title = label, onClick
}: RailButtonProps) => (
  <LabelledButton
    className={className}
    disabled={disabled}
    expanded={expanded}
    hidden={hidden}
    label={label}
    pressed={pressed}
    ref={ref}
    title={title}
    onClick={onClick}
  >
    {children}
  </LabelledButton>
);

interface RailImageProps {
  source: string;
}
/** A decorative rail icon (the button carries the name). */
export const RailImage = ({ source }: RailImageProps) => <img alt="" draggable={false} src={source} />;
