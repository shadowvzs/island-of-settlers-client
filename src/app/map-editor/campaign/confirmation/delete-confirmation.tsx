import type { CampaignEditor } from "../campaign-editor";
import { DELETE_CONFIRMATION_TITLE_ID as TITLE_ID } from "../constants";
import { useDeleteConfirmation } from "./use-delete-confirmation";

import "./delete-confirmation.css";

interface DeleteConfirmationProps {
  editor: CampaignEditor;
}
/**
 * Asks before a campaign or map is deleted (owner 2026-11-11): HUD paper panel over a dimmed page, naming what is
 * removed; Cancel is focused, the destructive button is set apart in the danger tone.
 */
export const DeleteConfirmation = ({ editor }: DeleteConfirmationProps) => {
  const { busy, cancelRef, view } = useDeleteConfirmation(editor);
  if (!view) return null;
  return (
    <div className="campaign-confirm">
      <section aria-describedby={`${TITLE_ID}-body`} aria-labelledby={TITLE_ID} aria-modal="true"
        className="campaign-confirm__panel" role="alertdialog">
        <h2 className="campaign-confirm__title" id={TITLE_ID}>{view.title}</h2>
        <div className="campaign-confirm__body" id={`${TITLE_ID}-body`}>
          <p>{view.intro}</p>
          <ul className="campaign-confirm__items">
            {view.items.map(item => <li key={item}>{item}</li>)}
          </ul>
          {view.notes.map(note => <p className="campaign-confirm__note" key={note}>{note}</p>)}
        </div>
        <div className="campaign-confirm__actions">
          <button className="campaign-confirm__button" ref={cancelRef} type="button" onClick={editor.cancelDeletion}>
            {view.cancelLabel}
          </button>
          <button className="campaign-confirm__button campaign-confirm__button--danger" disabled={busy}
            type="button" onClick={editor.confirmDeletion}>{view.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
};
