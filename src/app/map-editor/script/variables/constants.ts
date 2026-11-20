import type { ValueType } from "../../../../../../island-of-settlers-shared/src/script/types/values";

/** Constants of the variable editor (design §13.4, lane TRG12). */

/** Variable types the Variables tab creates (boards are made on the Multiboards tab), in menu order. */
export const VARIABLE_TYPES = [
  "number", "boolean", "string", "text", "number[]", "string[]", "actor", "actorGroup", "region", "timer"
] as const satisfies readonly ValueType[];
export type EditableVariableType = (typeof VARIABLE_TYPES)[number];

/** A new timer's length (script seconds). */
export const DEFAULT_TIMER_SECONDS = 120;

/** A new actor group's maximum length. */
export const DEFAULT_GROUP_LENGTH = 8;

/** The base name of a new variable ("value", "value2", …). */
export const NEW_VARIABLE_NAME = "value";
