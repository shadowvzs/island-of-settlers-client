import type { ScriptQuest } from "../../../../../../island-of-settlers-shared/src/script/types/quests";
import { RewardIcons } from "../../../settlement-ui/reward-icons/reward-icons";
import { RowList } from "../form-sections";
import { ScriptIconButton } from "../icon-button";
import type { ScriptWorkspace } from "../script-workspace";
import { IssueList } from "../sentence-row";
import { QuestTextFields } from "../text-language-inputs";
import { type FormLabels, useFormLabels } from "../use-form-labels";
import type { ScriptDialogs } from "../use-script-dialogs";
import { QuestObjective } from "./quest-objective";
import { RewardLine } from "./reward-line";
import { DeadlineFields, RepeatFields } from "./schedule-fields";
import { type QuestFormView, useQuestForm } from "./use-quest-form";
import { type QuestLabels, useQuestLabels } from "./use-quest-labels";
import { useQuestRewards } from "./use-quest-rewards";

interface PartProps {
  form: QuestFormView;
  labels: QuestLabels;
}

/** Texts, visibility, how it starts, group, optional and prerequisites. */
const QuestBasics = ({ form, labels }: PartProps) => {
  const { quest } = form;
  return (
    <>
      <QuestTextFields label={labels.title} text={quest.title ?? { en: "" }} onCommit={value => form.onText("title",
        value)} />
      <QuestTextFields label={labels.text} multiline text={quest.text ?? { en: "" }}
        onCommit={value => form.onText("text", value)} />
      <div className="script-variable__fields">
        <label>{labels.visibility}<select value={quest.visibility}
          onChange={event => form.onVisibility(event.target.value)}>
          <option value="visible">{labels.visible}</option>
          <option value="hidden">{labels.hidden}</option>
        </select></label>
        <label>{labels.activation}<select value={quest.activation ?? "auto"}
          onChange={event => form.onActivation(event.target.value)}>
          <option value="auto">{labels.activationAuto}</option>
          <option value="action">{labels.activationAction}</option>
        </select></label>
        <label>{labels.group}<select value={quest.groupId ?? ""} onChange={event => form.onGroup(event.target.value)}>
          {form.groups.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
        </select></label>
        <label><input checked={Boolean(quest.optional)} type="checkbox"
          onChange={event => form.onOptional(event.target.checked)} />{labels.optional}</label>
      </div>
      {quest.visibility === "hidden" && <p className="script-form__note">{labels.hiddenNote}</p>}
      {form.others.length > 0 && (
        <fieldset className="script-quest__prerequisites">
          <legend>{labels.prerequisites}</legend>
          {form.others.map(other => (
            <label key={other.key}><input checked={other.checked} type="checkbox"
              onChange={event => form.onPrerequisite(other.key, event.target.checked)} />{other.label}</label>
          ))}
        </fieldset>
      )}
    </>
  );
};

interface ActionListProps {
  field: "onActivate" | "onFailure" | "onSuccess";
  form: QuestFormView;
  formLabels: FormLabels;
  title: string;
}
/** One of the quest's action lists, edited like a trigger's DO. */
const ActionList = ({ field, form, formLabels, title }: ActionListProps) => (
  <section className="script-form__section">
    <h4>{title}</h4>
    <RowList form={form} labels={formLabels} rows={form.blocks[field].rows} />
    <IssueList issues={form.blocks[field].issues} />
  </section>
);

interface QuestRewardsSectionProps {
  campaign: boolean;
  dialogs: ScriptDialogs;
  form: QuestFormView;
}
/** Cost, map reward, home reward and the campaign replay share. */
const QuestRewardsSection = ({ campaign, dialogs, form }: QuestRewardsSectionProps) => {
  const view = useQuestRewards(form.quest, campaign, dialogs, form.onFields);
  return (
    <section className="script-form__section">
      <RewardLine editLabel={view.edit} line={view.cost} nothing={view.nothing} />
      <RewardLine editLabel={view.edit} line={view.map} nothing={view.nothing} />
      <RewardLine editLabel={view.edit} line={view.home} nothing={view.nothing} />
      {view.replay && (
        <div className="script-quest__replay">
          <p className="script-form__note">{view.replay.note}</p>
          {view.replay.paid && <RewardIcons view={view.replay.icons} />}
        </div>
      )}
    </section>
  );
};

interface QuestFormProps {
  campaign: boolean;
  dialogs: ScriptDialogs;
  quest: ScriptQuest;
  workspace: ScriptWorkspace;
}
/** The quest form (design §13.6): one quest of the book with live validation like the trigger form. */
export const QuestForm = ({ campaign, dialogs, quest, workspace }: QuestFormProps) => {
  const form = useQuestForm(workspace, quest, dialogs);
  const labels = useQuestLabels();
  const formLabels = useFormLabels();
  return (
    <article className="script-form script-quest" data-quest={quest.id}>
      <QuestBasics form={form} labels={labels} />
      <IssueList issues={form.headerIssues} />
      <QuestObjective form={form} formLabels={formLabels} labels={labels} />
      <section className="script-form__section">
        <DeadlineFields deadline={quest.deadline} onChange={deadline => form.onFields({ deadline })} />
        <RepeatFields repeat={quest.repeat} onChange={repeat => form.onFields({ repeat })} />
      </section>
      <QuestRewardsSection campaign={campaign} dialogs={dialogs} form={form} />
      <ActionList field="onActivate" form={form} formLabels={formLabels} title={labels.onActivate} />
      <ActionList field="onSuccess" form={form} formLabels={formLabels} title={labels.onSuccess} />
      <ActionList field="onFailure" form={form} formLabels={formLabels} title={labels.onFailure} />
      <footer className="script-form__footer">
        <span>{form.usedBy}</span>
        <ScriptIconButton icon="delete" label={labels.delete} onClick={form.onDelete} />
      </footer>
    </article>
  );
};
