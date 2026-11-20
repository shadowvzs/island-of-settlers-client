import { getTooltipLineClassName,type TooltipLine } from "./info-tooltip-helpers";
import { useInfoTooltip } from "./use-info-tooltip";

import "./info-tooltip.css";

interface InfoTooltipProps {
  label: string;
  lines: readonly TooltipLine[];
  /** `blue` is the default compact help button; `paper` keeps the old HUD look on request. */
  variant?: "blue" | "paper";
}
const tooltipClassName = (variant: "blue" | "paper") => {
  if (variant === "blue") return "info-tooltip info-tooltip--blue";
  return "info-tooltip";
};
const tooltipGlyph = (variant: "blue" | "paper") => {
  if (variant === "blue") return "i";
  return "ⓘ";
};

/**
 * Info button (ⓘ) with a multiline tooltip (`role="tooltip"`, `aria-describedby`): hover, keyboard focus
 * or a tap shows it; Escape, a press outside, blur or leaving with the mouse hides it. The tooltip stays
 * in the DOM (hidden) so the description is always available to assistive technology.
 */
export const InfoTooltip = ({ label, lines, variant = "blue" }: InfoTooltipProps) => {
  const { anchorRef, tooltipRef, ...tooltip } = useInfoTooltip(lines);
  return (
    <span className={tooltipClassName(variant)} ref={anchorRef}>
      <button
        aria-describedby={tooltip.id}
        aria-expanded={tooltip.shown}
        aria-label={label}
        className="info-tooltip__button"
        type="button"
        onBlur={tooltip.onBlur}
        onClick={tooltip.onClick}
        onFocus={tooltip.onFocus}
        onKeyDown={tooltip.onKeyDown}
        onMouseEnter={tooltip.onMouseEnter}
        onMouseLeave={tooltip.onMouseLeave}
      >
        {tooltipGlyph(variant)}
      </button>
      <InfoTooltipContent {...tooltip} lines={lines} tooltipRef={tooltipRef} />
    </span>
  );
};

interface InfoTooltipContentProps extends
  Pick<ReturnType<typeof useInfoTooltip>, "id" | "position" | "shown" | "tooltipRef"> {
  lines: readonly TooltipLine[];
}
/** Shared description content for info icons and existing action-button triggers. */
export const InfoTooltipContent = ({ id, lines, position, shown, tooltipRef }: InfoTooltipContentProps) => (
  <div
    className="info-tooltip__content"
    hidden={!shown}
    id={id}
    ref={tooltipRef}
    role="tooltip"
    style={position}
  >
    {lines.map(line => <p className={getTooltipLineClassName(line)} key={line.text}>{line.text}</p>)}
  </div>
);
