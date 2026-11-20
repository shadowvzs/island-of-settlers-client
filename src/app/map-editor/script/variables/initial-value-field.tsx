import type { TimerDefinition } from "../../../../../../island-of-settlers-shared/src/script/types/multiboards";
import type { QuestText } from "../../../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { ScriptRef } from "../../../../../../island-of-settlers-shared/src/script/types/refs";
import { ScriptIconButton } from "../icon-button";
import { QuestTextFields } from "../text-language-inputs";
import { regionValue, timerSeconds, timerWindow, type VariableRow } from "./helpers";
import type { VariablePanelView } from "./use-variable-panel";
import { editArray } from "./variable-edits";

interface FieldProps {
  row: VariableRow;
  view: VariablePanelView;
}

/** A number list or word list: one input per item, remove, "+ item" (each blur commits). */
const ArrayItems = ({ row, view }: FieldProps) => {
  const { initial, type } = row.variable;
  const value = initial.value as (number | string)[];
  const set = (index: number, text: string | null) =>
    view.onInitial(row.id, { type, value: editArray(value, type, index, text) } as typeof initial);
  return (
    <div className="script-variable__items">
      {row.items.map(item => (
        <span className="script-variable__item" key={`${item.index}:${item.value}`}>
          <input aria-label={item.label} className="input-count" defaultValue={item.value}
            onBlur={event => set(item.index, event.target.value)} />
          <ScriptIconButton icon="delete" label={item.removeLabel} onClick={() => set(item.index, null)} />
        </span>
      ))}
      <ScriptIconButton icon="add" label={view.labels.addItem} onClick={() => set(value.length, "")} />
    </div>
  );
};

const TimerFields = ({ row, view }: FieldProps) => {
  const timer = row.variable.initial.value as TimerDefinition;
  const set = (change: Partial<TimerDefinition>) => view.onInitial(row.id, { type: "timer", value: { ...timer,
    ...change } });
  const { labels } = view;
  return (
    <div className="script-variable__fields">
      <label>{labels.timerSeconds}<input className="input-count" defaultValue={timer.seconds} inputMode="numeric"
        key={`${row.id}:${timer.seconds}`} min={1} type="number"
        onBlur={event => set({ seconds: timerSeconds(event.target.value) })} /></label>
      <label><input checked={timer.autoStart} type="checkbox"
        onChange={event => set({ autoStart: event.target.checked })} />{labels.timerAutoStart}</label>
      <label><input checked={timer.periodic} type="checkbox"
        onChange={event => set({ periodic: event.target.checked })} />{labels.timerPeriodic}</label>
      <label><input checked={timer.window !== null} type="checkbox"
        onChange={event => set({ window: timerWindow(event.target.checked) })} />
      {labels.timerWindow}</label>
      {timer.window && <QuestTextFields label={labels.timerTitle} text={timer.window.title}
        onCommit={title => set({ window: { title } })} />}
    </div>
  );
};

/** The initial value editor of the variable's type (design §13.4 "Initial"). */
export const InitialValueField = ({ row, view }: FieldProps) => {
  const { initial } = row.variable;
  const { labels } = view;
  switch (row.editor) {
    case "boolean": return <label><input checked={initial.value as boolean} type="checkbox"
      onChange={event => view.onInitial(row.id, { type: "boolean", value: event.target.checked })} />
    {labels.yes}</label>;
    case "number": return <input aria-label={labels.initial} className="input-count"
      defaultValue={initial.value as number} key={`${row.id}:${String(initial.value)}`} type="number"
      onBlur={event => view.onInitial(row.id, { type: "number", value: Number(event.target.value) || 0 })} />;
    case "string": return <input aria-label={labels.initial} defaultValue={initial.value as string}
      key={`${row.id}:${String(initial.value)}`}
      onBlur={event => view.onInitial(row.id, { type: "string", value: event.target.value })} />;
    case "text": return <QuestTextFields label={labels.initial} text={initial.value as QuestText}
      onCommit={text => view.onInitial(row.id, { type: "text", value: text })} />;
    case "array": return <ArrayItems row={row} view={view} />;
    case "region": return (
      <select aria-label={labels.initial} value={(initial.value as ScriptRef | null)?.id ?? ""}
        onChange={event => view.onInitial(row.id, regionValue(event.target.value))}>
        <option value="">{labels.noRegion}</option>
        {view.regions.map(region => <option key={region.key} value={region.key}>{region.label}</option>)}
      </select>
    );
    case "timer": return <TimerFields row={row} view={view} />;
    case "board": return <p className="script-form__note">{labels.boardNote}</p>;
    case "runtime": return <p className="script-form__note">{labels.runtime}</p>;
  }
};
