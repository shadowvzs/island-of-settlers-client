import type { ReactNode } from "react";

import { getSectionIcon } from "./helpers";
import { type InfoContent, InlineInfo } from "./info-hint";
import { SettlementIcon } from "./settlement-icon";

interface SectionProps {
  children: ReactNode;
  /** Explicit icon name; translated titles cannot use the English title lookup. */
  icon?: string;
  info?: InfoContent;
  title: string;
}
/** Titled settings section with its rendered icon and optional inline help button. */
export const Section = ({ children, icon, info, title }: SectionProps) => (
  <section className="settings-panel__section">
    <h2>
      <SettlementIcon name={icon ?? getSectionIcon(title)} />
      {title}
      {info && <InlineInfo info={info} />}
    </h2>
    {children}
  </section>
);
