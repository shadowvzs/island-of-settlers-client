import type { QuestDeadline, QuestRepeat } from "../../../../../../island-of-settlers-shared/src/script/types/quests";
import {
  type DeadlineFieldsView, type RepeatFieldsView, useDeadlineFields, useRepeatFields
} from "./use-quest-schedule";
import { useScheduleLabels } from "./use-schedule-labels";

type Labels = ReturnType<typeof useScheduleLabels>;

interface NumberFieldProps {
  label: string;
  value: number | string;
  onCommit: (value: string) => void;
}
/** A small whole-number input that commits on blur. */
const NumberField = ({ label, value, onCommit }: NumberFieldProps) => (
  <label>{label}<input className="input-count" defaultValue={value} inputMode="numeric" key={String(value)} min={0}
    type="number" onBlur={event => onCommit(event.target.value)} /></label>
);

interface CalendarProps {
  labels: Labels;
  view: RepeatFieldsView;
}
const CalendarFields = ({ labels, view }: CalendarProps) => (
  <>
    <label>{labels.month}<select value={view.month} onChange={event => view.onCalendar("month", event.target.value)}>
      {view.options.months.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select></label>
    <label>{labels.day}<select value={view.day} onChange={event => view.onCalendar("day", event.target.value)}>
      {view.options.days.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select></label>
    <label>{labels.weekday}<select value={view.weekday}
      onChange={event => view.onCalendar("weekday", event.target.value)}>
      {view.options.weekdays.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select></label>
    <label>{labels.timeUtc}<input defaultValue={view.time} key={view.time} type="time"
      onBlur={event => view.onTime(event.target.value)} /></label>
  </>
);

interface RepeatFieldsProps {
  repeat: QuestRepeat;
  retry?: boolean;
  onChange: (repeat: QuestRepeat) => void;
}
/** Once / after each claim / interval d-h-m / calendar (UTC), retry after failure, and the next claim dates. */
export const RepeatFields = ({ repeat, retry = true, onChange }: RepeatFieldsProps) => {
  const view = useRepeatFields(repeat, onChange);
  const labels = useScheduleLabels();
  const { repeat: rule } = view;
  return (
    <div className="script-quest__schedule">
      <div className="script-variable__fields">
        <label>{labels.repeat}<select value={view.kind} onChange={event => view.onKind(event.target.value)}>
          {view.kinds.map(kind => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
        </select></label>
        {rule.kind === "onCompletion" && <NumberField label={labels.maxClaims} value={view.maxClaims}
          onCommit={view.onMaxClaims} />}
        {rule.kind === "interval" && (
          <>
            <NumberField label={labels.days} value={rule.days} onCommit={value => view.onInterval("days", value)} />
            <NumberField label={labels.hours} value={rule.hours} onCommit={value => view.onInterval("hours", value)} />
            <NumberField label={labels.minutes} value={rule.minutes}
              onCommit={value => view.onInterval("minutes", value)} />
          </>
        )}
        {rule.kind === "calendar" && <CalendarFields labels={labels} view={view} />}
        {retry && <label><input checked={rule.retryAfterFail} type="checkbox"
          onChange={event => view.onRetry(event.target.checked)} />{labels.retry}</label>}
      </div>
      {view.claimDates.length > 0 && (
        <div className="script-quest__claims">
          <span>{labels.claimDates}</span>
          <ul>{view.claimDates.map(date => <li key={date}>{date}</li>)}</ul>
        </div>
      )}
      <p className="script-form__note">{labels.claimHistory}</p>
    </div>
  );
};

interface DeadlineProps {
  labels: Labels;
  view: DeadlineFieldsView;
}
const DeadlineValues = ({ labels, view }: DeadlineProps) => {
  const { deadline } = view;
  if (deadline?.kind === "playTime" || deadline?.kind === "gameTime")
    return <NumberField label={labels.seconds} value={deadline.seconds} onCommit={view.onSeconds} />;
  if (deadline?.kind === "date") return (
    <label>{labels.dateUtc}<input defaultValue={view.date} key={view.date} type="datetime-local"
      onBlur={event => view.onDate(event.target.value)} /></label>
  );
  if (deadline?.kind !== "dateAfterActivation") return null;
  return (
    <>
      <NumberField label={labels.days} value={deadline.days} onCommit={value => view.onDelay("days", value)} />
      <NumberField label={labels.hours} value={deadline.hours} onCommit={value => view.onDelay("hours", value)} />
      <NumberField label={labels.minutes} value={deadline.minutes}
        onCommit={value => view.onDelay("minutes", value)} />
    </>
  );
};

interface DeadlineFieldsProps {
  deadline: QuestDeadline | null;
  onChange: (deadline: QuestDeadline | null) => void;
}
/** None / play time / game time / a UTC date / a time after the quest starts. */
export const DeadlineFields = ({ deadline, onChange }: DeadlineFieldsProps) => {
  const view = useDeadlineFields(deadline, onChange);
  const labels = useScheduleLabels();
  return (
    <div className="script-variable__fields">
      <label>{labels.deadline}<select value={view.choice} onChange={event => view.onChoice(event.target.value)}>
        {view.choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
      </select></label>
      <DeadlineValues labels={labels} view={view} />
    </div>
  );
};
