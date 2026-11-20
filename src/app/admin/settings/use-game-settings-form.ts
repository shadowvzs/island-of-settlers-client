import { useCallback, useEffect, useRef, useState } from "react";

import type { GameSettings } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { publishEditorGameSettings } from "../../map-editor/map-rules/editor-game-settings";
import type { AdminPorts, RevisionInfo, SettingsPort, SettingsSnapshot } from "../admin-ports";
import { errorText } from "../helpers";
import { type ChangeLine, changeLines, mapsGainingWarnings } from "./confirmation-helpers";

export type FormStatus = "error" | "loading" | "ready";

export interface PendingConfirmation {
  lines: ChangeLine[];
  /** Null until the campaign records are read. */
  mapWarnings: number | null;
}

export interface SaveOutcome {
  messages: string[];
  ok: boolean;
}

interface FormState {
  base: SettingsSnapshot | null;
  draft: GameSettings | null;
  error: string;
  latest: RevisionInfo | null;
  status: FormStatus;
}

const loadingState = (): FormState => ({ base: null, draft: null, error: "", latest: null, status: "loading" });

/** The stored settings and the footer's revision; an error state when the settings cannot be read. */
const fetchFormState = async (port: SettingsPort): Promise<FormState> => {
  try {
    const [base, latest] = await Promise.all([port.load(), port.latestRevision().catch(() => null)]);
    return { base, draft: base.settings, error: "", latest, status: "ready" };
  } catch (error) {
    return { ...loadingState(), error: errorText(error), status: "error" };
  }
};

/** Load, edit, confirm and save the deployment's settings through the window's settings port. */
export const useGameSettingsForm = (ports: AdminPorts) => {
  const { settings: port } = ports;
  const [state, setState] = useState<FormState>(loadingState);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const confirmationRevision = useRef(0);

  useEffect(() => {
    let live = true;
    const run = async () => {
      const next = await fetchFormState(port);
      if (live) setState(next);
    };
    void run();
    return () => { live = false; };
  }, [port]);

  const reload = async () => {
    setState(loadingState());
    setOutcome(null);
    setState(await fetchFormState(port));
  };

  const edit = useCallback((next: GameSettings) => {
    setOutcome(null);
    setState(current => ({ ...current, draft: next }));
  }, []);

  const save = async (settings: GameSettings) => {
    setBusy(true);
    setConfirmation(null);
    try {
      const result = await port.save(settings);
      if (!result.ok) return setOutcome({ messages: result.messages, ok: false });
      publishEditorGameSettings({ origin: port.store === "server" ? "server" : "cached", ...result.snapshot });
      const latest = await port.latestRevision().catch(() => null);
      setState({ base: result.snapshot, draft: result.snapshot.settings, error: "", latest, status: "ready" });
      setOutcome({ messages: result.warnings, ok: true });
    } catch (error) {
      setOutcome({ messages: [errorText(error)], ok: false });
    } finally {
      setBusy(false);
    }
  };

  const countMapWarnings = async (before: GameSettings, after: GameSettings, revision: number) => {
    const maps = await ports.campaignMaps().catch(() => []);
    if (confirmationRevision.current !== revision) return;
    const mapWarnings = mapsGainingWarnings(maps, before, after);
    setConfirmation(current => current && { ...current, mapWarnings });
  };

  /** Save: asks first when the players notice the change (consequences), else saves at once. */
  const requestSave = () => {
    const { base, draft } = state;
    if (!base || !draft) return;
    const lines = changeLines(base.settings, draft);
    if (!lines.length) return void save(draft);
    const revision = ++confirmationRevision.current;
    setConfirmation({ lines, mapWarnings: null });
    void countMapWarnings(base.settings, draft, revision);
  };

  const confirmSave = () => { if (state.draft) void save(state.draft); };
  const cancelConfirmation = () => {
    confirmationRevision.current++;
    setConfirmation(null);
  };

  return { ...state, busy, cancelConfirmation, confirmation, confirmSave, edit, outcome, reload, requestSave };
};

export type GameSettingsForm = ReturnType<typeof useGameSettingsForm>;
