import { InlineInfo } from "./info-hint";
import {
  type CollapsibleSectionOptions,
  type CollapsibleSectionViewProps,
  useCollapsibleSection
} from "./use-collapsible-section";

const chevron = (open: boolean) => {
  if (open) return "▾";
  return "▸";
};

/**
 * A settings block with an expand/collapse header: the title, the chevron and, while collapsed, a
 * short state summary. The header is a real button, so Enter and Space toggle it.
 */
export const CollapsibleSectionView = ({
  children, contentId, info, open, summary, title, onToggle
}: CollapsibleSectionViewProps) => (
  <section className="settings-panel__collapsible">
    <h3 className="settings-panel__collapsible-heading">
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="settings-panel__collapsible-toggle"
        type="button"
        onClick={onToggle}
      >
        <span aria-hidden="true" className="settings-panel__collapsible-chevron">{chevron(open)}</span>
        <span className="settings-panel__collapsible-title">{title}</span>
        {!open && <span className="settings-panel__collapsible-summary">— {summary}</span>}
      </button>
      {info && <InlineInfo info={info} />}
    </h3>
    <div className="settings-panel__collapsible-content" hidden={!open} id={contentId}>
      {children}
    </div>
  </section>
);

/** Collapsible settings block whose open state is remembered per section id. */
export const CollapsibleSection = (options: CollapsibleSectionOptions) =>
  <CollapsibleSectionView {...useCollapsibleSection(options)} />;
