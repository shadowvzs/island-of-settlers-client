import type { MapScript, ScriptVariable } from "../../../../../../island-of-settlers-shared/src/script/types/script";
import type { ScriptValue, ValueType } from "../../../../../../island-of-settlers-shared/src/script/types/values";
import { allocateId } from "../script-document";
import { itemUsers } from "../users";
import { DEFAULT_GROUP_LENGTH, DEFAULT_TIMER_SECONDS, NEW_VARIABLE_NAME } from "./constants";

/**
 * Pure edits of the map variables (design §4.5, §13.4): typed initial values, arrays, used-by and the delete
 * refusal. References are ids, so a rename changes nothing else; a type change is refused while the variable is used.
 */

/** The initial value a variable of a type starts with. */
export const defaultInitial = (type: ValueType): ScriptValue => {
  switch (type) {
    case "boolean": return { type, value: false };
    case "number": return { type, value: 0 };
    case "string": return { type, value: "" };
    case "number[]": return { type, value: [] };
    case "string[]": return { type, value: [] };
    case "text": return { type, value: { en: "" } };
    case "region": return { type, value: null };
    case "timer": return { type, value: { autoStart: false, periodic: false, seconds: DEFAULT_TIMER_SECONDS,
      window: null } };
    default: return { type: type as "actor", value: [] };
  }
};

/** A name not taken yet (case-insensitive): `base`, `base2`, `base3` … */
export const uniqueVariableName = (script: MapScript, base: string) => {
  const taken = new Set(script.variables.map(item => item.name.toLowerCase()));
  let name = base;
  for (let suffix = 2; taken.has(name.toLowerCase()); suffix += 1) name = `${base}${suffix}`;
  return name;
};

/** The owners that reference a variable (as a value, a board or a timer), the variable itself excluded. */
export const variableUsers = (script: MapScript, id: string) =>
  itemUsers(script, ["variable", "multiboard", "timer"], id, `variable:${id}`);

/** A new variable of a type; actor groups get a maximum length. */
export const addVariable = (script: MapScript, type: ValueType, base = NEW_VARIABLE_NAME) => {
  const { id, script: next } = allocateId(script, "variable");
  const variable: ScriptVariable = { id, initial: defaultInitial(type), name: uniqueVariableName(next, base), type,
    ...(type === "actorGroup" ? { maxLength: DEFAULT_GROUP_LENGTH } : {}) };
  return { script: { ...next, variables: [...next.variables, variable] }, variable };
};

export const replaceVariable = (script: MapScript, variable: ScriptVariable): MapScript =>
  ({ ...script, variables: script.variables.map(item => (item.id === variable.id ? variable : item)) });

export type VariableEditResult = { changed: true; script: MapScript } | { changed: false; users: string[] };

/** Removes an unused variable; refused (with its users) while referenced. */
export const removeVariable = (script: MapScript, id: string): VariableEditResult => {
  const users = variableUsers(script, id);
  if (users.length) return { changed: false, users };
  return { changed: true, script: { ...script, variables: script.variables.filter(item => item.id !== id) } };
};

/** Changes the type (the initial value restarts at the type's default); refused while referenced. */
export const retypeVariable = (script: MapScript, variable: ScriptVariable, type: ValueType): VariableEditResult => {
  const users = variableUsers(script, variable.id);
  if (users.length) return { changed: false, users };
  const { maxLength: _length, ...rest } = variable;
  return { changed: true, script: replaceVariable(script, { ...rest, initial: defaultInitial(type), type,
    ...(type === "actorGroup" ? { maxLength: DEFAULT_GROUP_LENGTH } : {}) }) };
};

/** An array item typed for its array: a number array keeps only finite numbers (else 0). */
export const arrayItem = (type: ValueType, text: string): number | string => {
  if (type !== "number[]") return text;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
};

/** The array value with one item set, appended (index = length) or removed (text null). */
export const editArray = (value: readonly (number | string)[], type: ValueType, index: number,
  text: string | null): (number | string)[] => {
  if (text === null) return value.filter((_item, position) => position !== index);
  const item = arrayItem(type, text);
  if (index >= value.length) return [...value, item];
  return value.map((current, position) => (position === index ? item : current));
};
