import { AdminIconButton } from "../admin-icon-button";
import type { ConfirmationView } from "./use-game-settings-tab";

interface ChangeDialogProps {
  view: ConfirmationView;
  onCancel: () => void;
  onConfirm: () => void;
}
/** The mode-change confirmation (owner Q2): the consequences in order; Cancel keeps the form unchanged. */
export const ChangeDialog = ({ view, onCancel, onConfirm }: ChangeDialogProps) => (
  <div className="admin-window__backdrop">
    <section aria-labelledby="admin-change-title" aria-modal="true" className="admin-window__dialog" role="dialog">
      <h2 id="admin-change-title">{view.title}</h2>
      <p>{view.intro}</p>
      <ul className="admin-settings__consequences">
        {view.lines.map(line => <li data-consequence={line.id} key={line.id}>{line.text}</li>)}
      </ul>
      {view.mapWarnings && <p className="admin-settings__note">{view.mapWarnings}</p>}
      <div className="admin-window__dialog-actions">
        <AdminIconButton icon="cancel" label={view.cancelLabel} onClick={onCancel} />
        <AdminIconButton icon="apply" label={view.saveLabel} onClick={onConfirm} />
      </div>
    </section>
  </div>
);
