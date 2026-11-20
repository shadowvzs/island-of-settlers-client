import type { ScriptTrigger } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import { EventSection, RowList } from "./form-sections";
import { ScriptIconButton } from "./icon-button";
import type { ScriptWorkspace } from "./script-workspace";
import { IssueList } from "./sentence-row";
import { type FormLabels, useFormLabels } from "./use-form-labels";
import type { ScriptDialogs } from "./use-script-dialogs";
import { type TriggerFormView, useTriggerForm } from "./use-trigger-form";

interface FormPartProps {
  form: TriggerFormView;
  labels: FormLabels;
}

/** On/off, name, folder, comment and the trigger buttons; uncontrolled text fields commit on blur (one undo step). */
const TriggerHeader = ({ form, labels }: FormPartProps) => (
  <div className="script-form__header">
    <label className="script-form__enabled"><input checked={form.enabled} type="checkbox"
      onChange={event => form.onEnabled(event.target.checked)} />{labels.enabled}</label>
    <label className="script-form__name">{labels.name}<input defaultValue={form.name}
      key={`${form.id}:name:${form.name}`}
      onBlur={event => form.onName(event.target.value)} /></label>
    <label>{labels.folder}<select value={form.folderId} onChange={event => form.onFolder(event.target.value)}>
      {form.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
    </select></label>
    <label className="script-form__comment">{labels.comment}<input defaultValue={form.comment}
      key={`${form.id}:comment:${form.comment}`} onBlur={event => form.onComment(event.target.value)} /></label>
    <div className="script-form__buttons">
      <ScriptIconButton icon="copy" label={labels.copyTrigger} onClick={form.onCopy} />
      <ScriptIconButton icon="delete" label={labels.deleteTrigger} onClick={form.onDelete} />
    </div>
  </div>
);

/** Advanced (collapsed): concurrency, run limit, and the "run trigger" hint (design §13.2, rev m13). */
const AdvancedSection = ({ form, labels }: FormPartProps) => (
  <details className="script-form__advanced">
    <summary>{labels.advanced}</summary>
    <label>{labels.concurrency}<select value={form.concurrency}
      onChange={event => form.onConcurrency(event.target.value)}>
      {form.concurrencyOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select></label>
    <label>{labels.runLimit}<input className="input-count" defaultValue={form.runLimit} inputMode="numeric"
      key={`${form.id}:limit:${form.runLimit}`} min={1} type="number"
      onBlur={event => form.onRunLimit(event.target.value)} /></label>
    <p className="script-form__note">{labels.runLimitHint}</p>
    <p className="script-form__note">{labels.runTriggerHint}</p>
  </details>
);

interface TriggerFormProps {
  dialogs: ScriptDialogs;
  trigger: ScriptTrigger;
  workspace: ScriptWorkspace;
}
/** The right column: one trigger as sentences (WHEN · IF · DO) with the explain line and live validation. */
export const TriggerForm = ({ dialogs, trigger, workspace }: TriggerFormProps) => {
  const labels = useFormLabels();
  const form = useTriggerForm(workspace, trigger, dialogs);
  return (
    <article className="script-form">
      <TriggerHeader form={form} labels={labels} />
      <p className="script-form__explain"><strong>{labels.explain}: </strong>{form.explain}</p>
      <IssueList issues={form.headerIssues} />
      <AdvancedSection form={form} labels={labels} />
      <EventSection form={form} labels={labels} />
      <section className="script-form__section">
        <h4>{labels.if}</h4>
        <RowList form={form} labels={labels} rows={form.conditionRows} />
        <button className="script-form__add" type="button"
          onClick={() => form.steps.onAddRootCondition(["conditions"])}>
          {labels.addCondition}
        </button>
      </section>
      <section className="script-form__section">
        <h4>{labels.do}</h4>
        <RowList form={form} labels={labels} rows={form.actionRows} />
        <IssueList issues={form.actionsIssues} />
      </section>
      <footer className="script-form__footer">
        <span>{form.issueSummary}</span>
        <span>{form.usedBy}</span>
      </footer>
    </article>
  );
};

/** The form of the selected trigger, or the hint to pick one. */
export const TriggerFormHost = ({ dialogs, trigger, workspace }: Omit<TriggerFormProps, "trigger"> & {
  trigger: ScriptTrigger | undefined;
}) => {
  const labels = useFormLabels();
  if (!trigger) return <p className="script-form__note">{labels.none}</p>;
  return <TriggerForm dialogs={dialogs} key={trigger.id} trigger={trigger} workspace={workspace} />;
};
