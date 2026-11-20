import { RowList } from "../form-sections";
import { IssueList, SentenceParts } from "../sentence-row";
import type { FormLabels } from "../use-form-labels";
import type { QuestFormView } from "./use-quest-form";
import type { QuestLabels } from "./use-quest-labels";

interface ObjectiveProps {
  form: QuestFormView;
  formLabels: FormLabels;
  labels: QuestLabels;
}

/** A condition goal: condition rows, "+ condition" and the optional progress (current / target). */
const ConditionGoal = ({ form, formLabels, labels }: ObjectiveProps) => (
  <>
    <RowList form={form} labels={formLabels} rows={form.blocks.objective} />
    <button className="script-form__add" type="button"
      onClick={() => form.steps.onAddRootCondition(["objective", "condition"])}>{labels.addCondition}</button>
    <label><input checked={form.blocks.progress.length > 0} type="checkbox"
      onChange={event => form.onProgress(event.target.checked)} />{labels.showProgress}</label>
    {form.blocks.progress.length > 0 && (
      <p className="script-quest__progress">{labels.progress}:{" "}
        {form.blocks.progress.map(block => (
          <span data-error={block.hasError} key={block.key}>
            <SentenceParts labels={formLabels} parts={block.parts} onOpenSlot={form.onOpenSlot} />{" "}
          </span>
        ))}
      </p>
    )}
  </>
);

/** A counter goal that counts offline too (`counterReached`). */
const CounterGoal = ({ form, labels }: Omit<ObjectiveProps, "formLabels">) => {
  const { objective } = form.quest;
  if (objective.kind !== "counterReached") return null;
  return (
    <div className="script-variable__fields">
      <label>{labels.counter}<input defaultValue={objective.counter} key={objective.counter}
        onBlur={event => form.onCounter(event.target.value)} /></label>
      <label>{labels.target}<input className="input-count" defaultValue={objective.target} key={objective.target}
        min={1} type="number" onBlur={event => form.onCounterTarget(event.target.value)} /></label>
      <label>{labels.since}<select value={objective.since} onChange={event => form.onCounterSince(
        event.target.value)}>
        <option value="activation">{labels.sinceActivation}</option>
        <option value="mapStart">{labels.sinceMapStart}</option>
      </select></label>
      <p className="script-form__note">{labels.counterHint}</p>
    </div>
  );
};

/** "Completed when" (design §13.6): one choice, then its fields; and the optional failure condition. */
export const QuestObjective = ({ form, formLabels, labels }: ObjectiveProps) => (
  <>
    <section className="script-form__section">
      <h4>{labels.completedWhen}</h4>
      <select aria-label={labels.completedWhen} value={form.choice}
        onChange={event => form.onObjective(event.target.value)}>
        {form.choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
      </select>
      {form.choice === "condition" && <ConditionGoal form={form} formLabels={formLabels} labels={labels} />}
      {form.choice === "counterReached" && <CounterGoal form={form} labels={labels} />}
      {form.choice === "scripted" && <p className="script-form__note">{labels.scriptedNote}</p>}
      {form.choice === "builtIn" && (
        <p className="script-quest__builtin" data-error={form.blocks.builtIn.hasError}>
          <SentenceParts labels={formLabels} parts={form.blocks.builtIn.parts} onOpenSlot={form.onOpenSlot} />
        </p>
      )}
      <IssueList issues={form.objectiveIssues} />
    </section>
    <section className="script-form__section">
      <h4>{labels.failure}</h4>
      <label><input checked={form.quest.failure !== null} type="checkbox"
        onChange={event => form.onFailureOn(event.target.checked)} />{labels.failureOn}</label>
      {form.quest.failure && (
        <>
          <RowList form={form} labels={formLabels} rows={form.blocks.failure} />
          <button className="script-form__add" type="button"
            onClick={() => form.steps.onAddRootCondition(["failure"])}>{labels.addCondition}</button>
        </>
      )}
    </section>
  </>
);
