import { InfoTooltip } from "./info-tooltip";

/** An inline help text and its accessible label. */
export interface InfoContent {
  label: string;
  text: string;
}

/** The blue info button placed beside the control it explains. */
export const InlineInfo = ({ info }: { info: InfoContent }) => (
  <InfoTooltip label={info.label} lines={[{ text: info.text }]} variant="blue" />
);
