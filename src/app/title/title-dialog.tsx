import { IconButton } from "../components/icon-button";
import type { TitleAction } from "./use-title-page";

interface TitleDialogProps {
  actions: readonly TitleAction[];
  busy: boolean;
  /** Distinct per dialog (it labels the dialog). */
  id: string;
  question: string;
}
/** A small non-blocking question over the title page: the landing after a won map, or "Abandon the current map?". */
export const TitleDialog = ({ actions, busy, id, question }: TitleDialogProps) => (
  <section aria-labelledby={id} className="title-page__dialog" role="dialog">
    <h2 className="title-page__dialog-question" id={id}>{question}</h2>
    <div className="title-page__dialog-actions">
      {actions.map(action => (
        <IconButton
          caption={action.label}
          data={{ "data-title-action": action.id }}
          disabled={busy}
          icon={action.icon}
          key={action.id}
          onClick={action.onClick}
        />
      ))}
    </div>
  </section>
);
