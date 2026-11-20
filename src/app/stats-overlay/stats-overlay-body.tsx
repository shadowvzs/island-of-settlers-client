import { useLingui } from "@lingui/react";
import { useState } from "react";

import { useExternalStore } from "../components/external-store";
import type { ReadableStore } from "../components/ui-store";
import type { StatsOverlayText } from "./helpers";
import { STATS_MESSAGES as M } from "./messages";

interface StatsOverlayBodyProps {
  text: ReadableStore<StatsOverlayText>;
}
/** Clipboard pictogram; the panel has no dedicated rendered action icon. */
const CopyIcon = () => (
  <svg aria-hidden="true" className="stats-overlay__copy-icon" focusable="false" viewBox="0 0 24 24">
    <path d="M8 4.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V6A1.5 1.5 0 0 1 8 4.5Z" />
    <path d="M9.5 4.5V3h5v1.5M9 9h6M9 12.5h6M9 16h4" />
  </svg>
);

/** Info panel body: the live frame statistics (`pre`, re-rendered every 0.5 s stats tick) and the controls help. */
export const StatsOverlayBody = ({ text }: StatsOverlayBodyProps) => {
  const { i18n } = useLingui();
  const { help, stats } = useExternalStore(text);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${stats}\n\n${help}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard access can be denied by the browser; the panel simply keeps its current state.
    }
  };
  let label = i18n._(M.copy.label), title = label;
  if (copied) { label = i18n._(M.copy.copied); title = i18n._(M.copy.copiedTitle); }
  return (
    <div className="stats-overlay__body">
      <button
        aria-label={label}
        className="stats-overlay__copy"
        title={title}
        type="button"
        onClick={copy}
      >
        <CopyIcon />
      </button>
      <pre>{stats}</pre>
      <p className="stats-overlay__help">{help}</p>
    </div>
  );
};
