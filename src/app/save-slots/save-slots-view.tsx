import { IconButton } from "../components/icon-button";
import { INPUT_SIZE_CLASSES } from "../components/input-sizes";
import { SLOT_LABEL_MAX_LENGTH } from "./constants";
import type { SlotRow } from "./helpers";
import { type SaveSlotsModel, type SaveSlotsOptions, useSaveSlots } from "./use-save-slots";

import "./save-slots.css";

interface SlotRowViewProps {
  busy: boolean;
  row: SlotRow;
  onChoose: SaveSlotsModel["onChoose"];
}
/** One slot: number, name, what it shows, date, and its icon actions. */
const SlotRowView = ({ busy, row, onChoose }: SlotRowViewProps) => (
  <li className="save-slots__row" data-save-slot={row.number} data-save-slot-empty={row.empty || undefined}>
    <span className="save-slots__number">{row.number}</span>
    <span className="save-slots__text">
      <strong className="save-slots__title">{row.title}</strong>
      <span className="save-slots__detail">{row.detail}</span>
      {row.date && <time className="save-slots__date">{row.date}</time>}
    </span>
    <span className="save-slots__actions">
      {row.actions.map(action => (
        <IconButton
          data={{ "data-save-slot-action": action.id }}
          disabled={busy}
          icon={action.icon}
          key={action.id}
          label={action.label}
          onClick={() => onChoose(action.id, row.number)}
        />
      ))}
    </span>
  </li>
);

interface SlotConfirmProps {
  busy: boolean;
  cancelLabel: string;
  confirm: string;
  question: string;
  onCancel: () => void;
  onConfirm: () => void;
}
/** The in-place question of an overwrite, load or delete (no browser dialog). */
const SlotConfirm = ({ busy, cancelLabel, confirm, question, onCancel, onConfirm }: SlotConfirmProps) => (
  <div aria-labelledby="save-slots-question" className="save-slots__confirm" role="group">
    <p className="save-slots__question" id="save-slots-question">{question}</p>
    <span className="save-slots__confirm-actions">
      <IconButton
        caption={confirm}
        data={{ "data-save-slot-confirm": "" }}
        disabled={busy}
        icon="apply"
        onClick={onConfirm}
      />
      <IconButton caption={cancelLabel} disabled={busy} icon="cancel" onClick={onCancel} />
    </span>
  </div>
);

interface SaveSlotsViewProps {
  model: SaveSlotsModel;
}
/**
 * The Save/Load slot list (plan §5.6): optional save name, then the confirmation and the result line above the slots,
 * so both stay in view however long the list is.
 */
export const SaveSlotsView = ({ model }: SaveSlotsViewProps) => (
  <div className="save-slots">
    {model.labelShown && (
      <input
        aria-label={model.labelPlaceholder}
        className={`save-slots__label ${INPUT_SIZE_CLASSES.long}`}
        maxLength={SLOT_LABEL_MAX_LENGTH}
        placeholder={model.labelPlaceholder}
        type="text"
        value={model.label}
        onChange={event => model.onLabelChange(event.target.value)}
      />
    )}
    {model.confirmation && (
      <SlotConfirm
        busy={model.busy}
        cancelLabel={model.cancelLabel}
        confirm={model.confirmation.confirm}
        question={model.confirmation.question}
        onCancel={model.onCancel}
        onConfirm={model.onConfirm}
      />
    )}
    <p aria-live="polite" className="save-slots__status" role="status">{model.status}</p>
    {!model.rows && <p className="save-slots__note">{model.loadingText}</p>}
    {model.rows && (
      <ol aria-label={model.listLabel} className="save-slots__list">
        {model.rows.map(row => (
          <SlotRowView busy={model.busy} key={row.number} row={row} onChoose={model.onChoose} />
        ))}
      </ol>
    )}
  </div>
);

/** The slot list with its own state: the window (in game) and the title page mount this. */
export const SaveSlots = (options: SaveSlotsOptions) => <SaveSlotsView model={useSaveSlots(options)} />;
