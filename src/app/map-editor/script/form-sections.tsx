import type { KeyboardEvent } from "react";

import type { StepOptions } from "./blocks";
import { focusOnMount } from "./focus";
import { type ShownBlock, type ShownRow, shownRowKey } from "./form-rows";
import { ScriptIconButton } from "./icon-button";
import type { NodePath } from "./paths";
import { RowMenu, SentenceRow } from "./sentence-row";
import type { FormLabels } from "./use-form-labels";
import { useRowEditing } from "./use-row-editing";
import type { TriggerFormView } from "./use-trigger-form";

type Form = TriggerFormView;
/** What condition and action rows need from their form: the row commands and the slot picker. */
export type RowForm = Pick<TriggerFormView, "onOpenSlot" | "steps">;

const rowKey = (form: RowForm, path: NodePath) => (event: KeyboardEvent<HTMLLIElement>) => {
  if (form.steps.onRowKey(path, event.key, event.ctrlKey || event.metaKey)) event.preventDefault();
};

interface EventSectionProps {
  form: Form;
  labels: FormLabels;
}
/** WHEN (any of): the event rows with their menus and "+ event". */
export const EventSection = ({ form, labels }: EventSectionProps) => (
  <section className="script-form__section">
    <h4>{labels.when}</h4>
    {form.noEvents && <p className="script-form__note">{labels.noEvents}</p>}
    <ul className="script-rows">
      {form.eventRows.map(row => (
        <SentenceRow block={row} depth={0} key={row.key} labels={labels} menu={<RowMenu canInvert={row.canInvert}
          disabled={false} isStep={false} labels={labels} path={row.path} steps={form.steps} />}
        onKeyDown={rowKey(form, row.path)} onOpenSlot={form.onOpenSlot} />
      ))}
    </ul>
    <button className="script-form__add" type="button" onClick={form.steps.onAddEvent}>{labels.addEvent}</button>
  </section>
);

interface StepOptionsBarProps {
  labels: FormLabels;
  options: StepOptions;
  path: NodePath;
  steps: RowForm["steps"];
}
/** "Wait until done" with timeout and stop-on-fail, the order lock, and the run-trigger switches. */
const StepOptionsBar = ({ labels, options, path, steps }: StepOptionsBarProps) => (
  <div className="script-row__options">
    {options.wait !== undefined && (
      <label><input checked={options.wait !== null} type="checkbox"
        onChange={event => steps.onWaitToggle(path, event.target.checked)} />{labels.waitDone}</label>
    )}
    {options.wait && (
      <>
        <label>{labels.waitTimeout}<input className="input-count" defaultValue={options.wait.timeoutSeconds}
          inputMode="numeric" min={1} type="number"
          onBlur={event => steps.onWaitTimeout(path, Number(event.target.value))} /></label>
        <label><input checked={options.wait.onFail === "stop"} type="checkbox"
          onChange={event => steps.onWaitStop(path, event.target.checked)} />{labels.stopOnFail}</label>
      </>
    )}
    {options.overridable !== null && (
      <label><input checked={!options.overridable} type="checkbox"
        onChange={event => steps.onLock(path, event.target.checked)} />{labels.lockOrders}</label>
    )}
    {options.runTrigger && (
      <>
        <label><input checked={options.runTrigger.checkConditions} type="checkbox" onChange={event =>
          steps.onRunTriggerOption(path, "checkConditions", event.target.checked)} />{labels.checkConditions}</label>
        <label><input checked={options.runTrigger.wait} type="checkbox" onChange={event =>
          steps.onRunTriggerOption(path, "wait", event.target.checked)} />{labels.waitForRun}</label>
        <p className="script-form__note">{labels.runTriggerHint}</p>
      </>
    )}
  </div>
);

interface StepRowProps {
  block: ShownBlock;
  depth: number;
  form: RowForm;
  labels: FormLabels;
  options: StepOptions;
}
const StepRow = ({ block, depth, form, labels, options }: StepRowProps) => {
  const comment = useRowEditing(text => form.steps.onComment(block.path, text));
  return (
    <SentenceRow block={block} depth={depth} labels={labels} menu={<RowMenu disabled={block.disabled} isStep
      labels={labels} path={block.path} steps={form.steps} onCommentEdit={comment.onEdit} />}
    onKeyDown={rowKey(form, block.path)} onOpenSlot={form.onOpenSlot}>
      <StepOptionsBar labels={labels} options={options} path={block.path} steps={form.steps} />
      {comment.editing && <input aria-label={labels.stepComment} className="script-row__comment-input"
        defaultValue={block.comment} ref={focusOnMount} onBlur={event => comment.onFinish(event.target.value)} />}
    </SentenceRow>
  );
};

interface RowsProps {
  form: RowForm;
  labels: FormLabels;
  rows: readonly ShownRow[];
}
const Row = ({ form, labels, row }: Omit<RowsProps, "rows"> & { row: ShownRow }) => {
  switch (row.kind) {
    case "step": return <StepRow block={row.block} depth={row.depth} form={form} labels={labels}
      options={row.options} />;
    case "condition": return <SentenceRow block={row.block} depth={row.depth} labels={labels} menu={<RowMenu
      disabled={false} isStep={false} labels={labels} path={row.block.path} steps={form.steps} />}
    onKeyDown={rowKey(form, row.block.path)} onOpenSlot={form.onOpenSlot} />;
    case "branch": return <li className="script-row__branch" data-depth={row.depth}>{labels[row.label]}</li>;
    case "addCondition": return (
      <li className="script-row__add" data-depth={row.depth}>
        <button type="button" onClick={() => form.steps.onAddCondition(row.listPath)}>{labels.addCondition}</button>
      </li>
    );
    case "addAction": return (
      <li className="script-row__add" data-depth={row.depth}>
        <button type="button" onClick={() => form.steps.onAddAction(row.listPath)}>{labels.addAction}</button>
        <ScriptIconButton icon="paste" label={labels.pasteStep} onClick={() => form.steps.onPasteSteps(row.listPath)} />
      </li>
    );
  }
};

/** Condition or action rows (nested groups, branches and add rows), in document order. */
export const RowList = ({ form, labels, rows }: RowsProps) => (
  <ul className="script-rows">
    {rows.map(row => <Row form={form} key={shownRowKey(row)} labels={labels} row={row} />)}
  </ul>
);
