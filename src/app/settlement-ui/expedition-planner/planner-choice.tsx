import { type KeyboardEvent, type ReactNode, useMemo } from "react";

import { InfoTooltipContent } from "../../components/info-tooltip";
import type { TooltipLine } from "../../components/info-tooltip-helpers";
import { useInfoTooltip } from "../../components/use-info-tooltip";

interface PlannerChoiceProps {
  checked: boolean;
  children: ReactNode;
  className: string;
  data: Record<`data-${string}`, string | number>;
  disabled: boolean;
  label: string;
  lines: readonly TooltipLine[];
  onChoose: () => void;
}

/** Selection opens the same description on touch; unavailable choices retain a focusable info trigger. */
export const PlannerChoice = ({ checked, children, className, data, disabled, label, lines, onChoose }: PlannerChoiceProps) => {
  const distinctLines = useMemo(() => lines.filter((line, index) =>
    lines.findIndex(other => other.text === line.text) === index), [lines]);
  const { anchorRef, tooltipRef, ...tooltip } = useInfoTooltip(distinctLines);
  return (
    <span className="colony-planner__choice" ref={anchorRef}
      onMouseEnter={tooltip.onMouseEnter} onMouseLeave={tooltip.onMouseLeave}>
      <button {...data}
        aria-checked={checked}
        aria-describedby={tooltip.id}
        aria-label={label}
        className={className}
        disabled={disabled}
        role="radio"
        type="button"
        onBlur={tooltip.onBlur}
        onClick={() => { onChoose(); tooltip.onClick(); }}
        onFocus={tooltip.onFocus}
        onKeyDown={tooltip.onKeyDown}
      >{children}</button>
      {disabled && <button
        aria-describedby={tooltip.id}
        aria-expanded={tooltip.shown}
        aria-label={label}
        className="colony-planner__choice-info"
        type="button"
        onBlur={tooltip.onBlur}
        onClick={tooltip.onClick}
        onFocus={tooltip.onFocus}
        onKeyDown={tooltip.onKeyDown}
      >ⓘ</button>}
      <InfoTooltipContent {...tooltip} lines={distinctLines} tooltipRef={tooltipRef} />
    </span>
  );
};

/** Match the radio-group arrow/Home/End convention while retaining ordinary native button activation. */
export const navigatePlannerChoices = (event: KeyboardEvent<HTMLDivElement>) => {
  const target = event.target as HTMLButtonElement;
  if (target.getAttribute("role") !== "radio") return;
  const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)'));
  const index = choices.indexOf(target);
  let next: number;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % choices.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + choices.length - 1) % choices.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = choices.length - 1;
  else return;
  const choice = choices[next];
  if (!choice) return;
  event.preventDefault(); choice.focus(); choice.click();
};
