import type { I18n } from "@lingui/core";

import type { ScriptTraceEntry } from "../../../../../island-of-settlers-shared/src/script/engine/trace";
import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { ScriptValue } from "../../../../../island-of-settlers-shared/src/script/types/values";
import { ticksToSeconds } from "../../../../../island-of-settlers-shared/src/time/constants";
import { translateMessage } from "../../../shared/i18n/translate";
import { TEST_PLAY_SLOT } from "../../map-editor/map-storage";
import { formatCountdown } from "../multiboard/helpers";
import {
  TEST_PLAY_MAP_PARAM, TEST_PLAY_ON, TEST_PLAY_PARAM, TEST_PLAY_SKIP_LOGIN_PARAM, TEST_PLAY_VALUE_LENGTH,
  type TestPlayLogKind
} from "./constants";
import { TEST_PLAY_MESSAGES as M } from "./messages";
import type { TestPlayLogRecord } from "./test-play-log";

/** True for a play-test page: the switch counts only together with the editor's own play-test map slot. */
export const isTestPlay = (search: string) => {
  const query = new URLSearchParams(search);
  return query.get(TEST_PLAY_PARAM) === TEST_PLAY_ON && query.get(TEST_PLAY_MAP_PARAM) === TEST_PLAY_SLOT;
};

/** The game page of a play-test, from any page of the same folder (the editor): only the play-test parameters. */
export const testPlayUrl = (href: string) => {
  const url = new URL("./", href);
  url.searchParams.set(TEST_PLAY_MAP_PARAM, TEST_PLAY_SLOT);
  url.searchParams.set(TEST_PLAY_PARAM, TEST_PLAY_ON);
  url.searchParams.set(TEST_PLAY_SKIP_LOGIN_PARAM, TEST_PLAY_ON);
  return url.href;
};

/** Game time of a tick as `mm:ss` (`h:mm:ss` from one hour on). */
export const formatGameTime = (tick: number) => formatCountdown(Math.floor(ticksToSeconds(tick)));

/** Names the log prints instead of ids (built once per script). */
export interface TestPlayNames {
  trigger: ReadonlyMap<string, string>;
  variable: ReadonlyMap<string, string>;
}

export const testPlayNames = (script: MapScript | undefined): TestPlayNames => ({
  trigger: new Map(script?.triggers.map(trigger => [trigger.id, trigger.name])),
  variable: new Map(script?.variables.map(variable => [variable.id, variable.name]))
});

const formatValue = (value: ScriptValue) => {
  const raw = value.value;
  const text = typeof raw === "object" && raw !== null ? JSON.stringify(raw) : String(raw);
  if (text.length <= TEST_PLAY_VALUE_LENGTH) return text;
  return `${text.slice(0, TEST_PLAY_VALUE_LENGTH)}…`;
};

type EntryOf<K extends ScriptTraceEntry["kind"]> = Extract<ScriptTraceEntry, { kind: K }>;

const runText = (entry: EntryOf<"run">, names: TestPlayNames, i18n?: I18n) => {
  const { owner, runId: run } = entry;
  if (owner.kind === "quest") {
    return translateMessage(i18n, M.line.questList, { list: owner.list, quest: owner.questId, run });
  }
  if (owner.kind !== "trigger") return translateMessage(i18n, M.line.step, { run, step: owner.sequenceId });
  const trigger = names.trigger.get(owner.triggerId) ?? owner.triggerId;
  if (entry.event === undefined) return translateMessage(i18n, M.line.triggerStarted, { run, trigger });
  return translateMessage(i18n, M.line.triggerFired, { event: entry.event, run, trigger });
};

/** The text of one log line in the active locale; ids are replaced by the script's names where it has them. */
export const logLineText = (entry: ScriptTraceEntry, names: TestPlayNames, i18n?: I18n) => {
  switch (entry.kind) {
    case "run": return runText(entry, names, i18n);
    case "step":
      return translateMessage(i18n, M.line.step, { run: entry.runId, step: entry.op ?? entry.stepKind });
    case "quest":
      return translateMessage(i18n, M.line.quest, { from: entry.from ?? "–", quest: entry.questId, to: entry.to });
    case "variable":
      return translateMessage(i18n, M.line.variable, {
        value: formatValue(entry.value), variable: names.variable.get(entry.variableId) ?? entry.variableId
      });
  }
};

export interface TestPlayLogRow {
  id: number;
  kind: TestPlayLogKind;
  text: string;
  time: string;
}

/** The shown rows, oldest first: records of the hidden kinds are left out. */
export const testPlayLogRows = (
  records: readonly TestPlayLogRecord[], hidden: ReadonlySet<TestPlayLogKind>, names: TestPlayNames, i18n?: I18n
): TestPlayLogRow[] =>
  records.filter(record => !hidden.has(record.entry.kind)).map(({ entry, id, tick }) => ({
    id, kind: entry.kind, text: logLineText(entry, names, i18n), time: formatGameTime(tick)
  }));

/** The filter set with one kind switched. */
export const toggledKinds = (hidden: ReadonlySet<TestPlayLogKind>, kind: TestPlayLogKind) => {
  const next = new Set(hidden);
  if (!next.delete(kind)) next.add(kind);
  return next;
};
