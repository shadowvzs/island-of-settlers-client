import { ScriptEngine } from "../../../../../../island-of-settlers-shared/src/script/engine/engine";
import { createNullWorldPort } from "../../../../../../island-of-settlers-shared/src/script/engine/ports";
import type { MultiboardSnapshot } from "../../../../../../island-of-settlers-shared/src/script/types/multiboards";
import type { MapScript } from "../../../../../../island-of-settlers-shared/src/script/types/script";
import { BOARD_VIEWER_FACTION } from "./constants";

/**
 * The live preview of one board (design §13.5): the real engine evaluates the board at map start with the
 * variables' initial values; world functions read nothing in the editor (zero). Triggers and quests do not run,
 * so a preview never changes anything. Null when the board cannot be evaluated yet (unset or invalid parts).
 */

const PREVIEW_SEED = 1;

export const previewBoard = (script: MapScript, boardId: string): MultiboardSnapshot | null => {
  const variables = script.variables.flatMap(variable => {
    if (variable.id !== boardId) return variable.type === "multiboard" ? [] : [variable];
    if (variable.initial.type !== "multiboard") return [];
    const board = { ...variable.initial.value, audience: { kind: "any" as const }, initiallyCollapsed: false,
      initiallyVisible: true };
    return [{ ...variable, initial: { type: "multiboard" as const, value: board } }];
  });
  const preview: MapScript = { ...script, quests: { ...script.quests, groups: [], quests: [] }, triggers: [],
    variables };
  try {
    const engine = ScriptEngine.create(preview, { port: createNullWorldPort(), scriptHash: "preview",
      seed: PREVIEW_SEED });
    return engine.multiboardSnapshots(BOARD_VIEWER_FACTION)[0] ?? null;
  } catch {
    return null;
  }
};
