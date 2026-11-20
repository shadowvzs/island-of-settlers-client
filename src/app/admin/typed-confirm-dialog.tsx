import { AdminIconButton } from "./admin-icon-button";
import type { ConfirmRequest } from "./confirm-request";
import { useTypedConfirm } from "./use-typed-confirm";

interface TypedConfirmDialogProps {
  request: ConfirmRequest;
  onCancel: () => void;
  onDone: (status: string) => void;
}
/** The confirmation of an administrator action: its effects, the text to type and the run/cancel icon buttons. */
export const TypedConfirmDialog = ({ request, onCancel, onDone }: TypedConfirmDialogProps) => {
  const dialog = useTypedConfirm(request, onDone);
  return (
    <div className="admin-window__backdrop">
      <section aria-labelledby="admin-confirm-title" aria-modal="true" className="admin-window__dialog" role="dialog">
        <h2 id="admin-confirm-title">{request.title}</h2>
        <ul className="admin-settings__consequences">
          {request.lines.map(line => <li key={line}>{line}</li>)}
        </ul>
        {request.option && (
          <label className="admin-settings__switch">
            <input checked={dialog.option} disabled={dialog.busy} type="checkbox"
              onChange={event => dialog.setOption(event.target.checked)} />
            <span>{request.option}</span>
          </label>
        )}
        {dialog.needsTyping && (
          <label className="admin-settings__field admin-maintenance__confirm-field">
            <span>{dialog.hint}</span>
            <input aria-label={dialog.inputLabel} autoComplete="off" disabled={dialog.busy} spellCheck={false}
              value={dialog.typed} onChange={event => dialog.setTyped(event.target.value)}
              onKeyDown={event => event.key === "Enter" && void dialog.submit()} />
          </label>
        )}
        {dialog.error && <p className="admin-settings__issues" role="alert">{dialog.error}</p>}
        <div className="admin-window__dialog-actions">
          <AdminIconButton icon="cancel" label={dialog.cancelLabel} onClick={onCancel} />
          <AdminIconButton disabled={!dialog.ready} icon="apply" label={request.confirmLabel}
            onClick={() => void dialog.submit()} />
        </div>
      </section>
    </div>
  );
};
