import type { CampaignEditor } from "../campaign-editor";
import type { CheckEntry, CheckGroup, CheckJumpTarget, CheckSection as CheckSectionModel } from "./helpers";
import { useCheckSection } from "./use-check-section";

import "./check-section.css";

interface CheckEntryRowProps {
  entry: CheckEntry;
  onJump: (target: CheckJumpTarget) => void;
}
/** One problem: a click leads to the place that fixes it. */
const CheckEntryRow = ({ entry, onJump }: CheckEntryRowProps) => (
  <li>
    <button className="campaign-check__entry" data-severity={entry.severity} title={entry.targetLabel} type="button"
      onClick={() => onJump(entry.target)}>
      <span>{entry.message}</span>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
    </button>
  </li>
);

interface CheckGroupListProps {
  group: CheckGroup;
  onJump: (target: CheckJumpTarget) => void;
}
const CheckGroupList = ({ group, onJump }: CheckGroupListProps) => (
  <div className="campaign-check__group" data-category={group.category}>
    <h4>{group.label}<span className="campaign-check__count">{group.entries.length}</span></h4>
    <ul>
      {group.entries.map(entry => <CheckEntryRow entry={entry} key={entry.id} onJump={onJump} />)}
    </ul>
  </div>
);

interface CheckDocumentProps {
  section: CheckSectionModel;
  onJump: (target: CheckJumpTarget) => void;
}
/** One checked document (the campaign or a map): collapsible, with its error and warning counts. */
const CheckDocument = ({ section, onJump }: CheckDocumentProps) => (
  <details className="campaign-check__section" open>
    <summary>
      <span className="campaign-check__title">{section.title}</span>
      {section.errors > 0 && <span className="campaign-check__badge" data-severity="error">
        {section.errorsLabel}
      </span>}
      {section.warnings > 0 && <span className="campaign-check__badge" data-severity="warning">
        {section.warningsLabel}
      </span>}
    </summary>
    {section.groups.map(group => <CheckGroupList group={group} key={group.category} onJump={onJump} />)}
  </details>
);

interface CheckSectionProps {
  editor: CampaignEditor;
}
/** The campaign Check (CUX-CHECK): every problem of the campaign and its maps, grouped, counted and clickable. */
export const CheckSection = ({ editor }: CheckSectionProps) => {
  const view = useCheckSection(editor);
  return (
    <section aria-label={view.title} className="campaign-editor__form campaign-check">
      <div className="campaign-check__bar">
        <button aria-label={view.runLabel} className="campaign-editor__icon-button campaign-check__run"
          disabled={view.busy} title={view.runLabel} type="button" onClick={editor.checkReady}>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4" />
            <path d="m8.5 12 2.5 2.5 4.5-5" />
          </svg>
        </button>
        {view.summary && <strong>{view.summary.totals}</strong>}
        {view.summary && <span className="campaign-editor__hint">{view.summary.coverage}</span>}
      </div>
      {view.note && <p className="campaign-editor__hint">{view.note}</p>}
      {view.sections.map(section => <CheckDocument key={section.id} section={section} onJump={view.onJump} />)}
    </section>
  );
};
