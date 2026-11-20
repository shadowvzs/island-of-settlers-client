import type { Ref } from "react";

import { joinClassNames } from "./helpers";
import { type DataAttributes, LabelledButton } from "./labelled-button";
import { SettlementIcon } from "./settlement-icon";

import "./icon-button.css";

interface IconButtonProps {
  /** Text beside the icon; a given caption always renders its span (also when empty). */
  caption?: string;
  className?: string;
  data?: DataAttributes;
  disabled?: boolean;
  hasPopup?: "dialog" | "true";
  hidden?: boolean;
  icon: string;
  /** Accessible name; the caption when not given. */
  label?: string;
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
  /** Tooltip when it differs from the accessible name. */
  title?: string;
  onClick: () => void;
}
/** The shared HUD icon button (`settlement-ui__button`): an icon, an optional caption, the label as tooltip. */
export const IconButton = ({
  caption, className, data, disabled, hasPopup, hidden, icon, label = caption ?? "", pressed, ref, title,
  onClick
}: IconButtonProps) => (
  <LabelledButton
    className={joinClassNames(
      "settlement-ui__button", caption === undefined && "settlement-ui__icon-button--compact", className
    )}
    data={data}
    disabled={disabled}
    hasPopup={hasPopup}
    hidden={hidden}
    label={label}
    pressed={pressed}
    ref={ref}
    title={title}
    onClick={onClick}
  >
    <SettlementIcon name={icon} />
    {caption !== undefined && <span>{caption}</span>}
  </LabelledButton>
);
