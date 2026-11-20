import { type ReactNode, useEffect, useRef } from "react";

import { joinClassNames } from "./helpers";

interface PopupProps {
  actions: ReactNode;
  children: ReactNode;
  className?: string;
  /** A new key (e.g. the content revision) moves focus to the first action again. */
  focusKey: unknown;
  labelledBy: string;
  tone: string;
}
/**
 * Alert dialog card of the settlement popups (`.settlement-popup__dialog`). The owner keeps the
 * backdrop, visibility and Escape; the dialog focuses its first action whenever `focusKey` changes.
 */
export const Popup = ({ actions, children, className, focusKey, labelledBy, tone }: PopupProps) => {
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { actionsRef.current?.querySelector("button")?.focus(); }, [focusKey]);
  return (
    <section
      aria-labelledby={labelledBy}
      aria-modal="true"
      className={joinClassNames("settlement-ui__panel settlement-popup__dialog", className)}
      data-tone={tone}
      role="alertdialog"
    >
      {children}
      <div className="settlement-popup__actions" ref={actionsRef}>{actions}</div>
    </section>
  );
};
