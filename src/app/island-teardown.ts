/** Ordered phases of an island teardown; earlier phases stop producers before consumers disappear. */
export type IslandTeardownPhase =
  | "stop-producers"
  | "recorders"
  | "controls"
  | "settlement-ui"
  | "island-owners"
  | "audio"
  | "renderer"
  | "debug";

const PHASE_ORDER: readonly IslandTeardownPhase[] = [
  "stop-producers",
  "recorders",
  "controls",
  "settlement-ui",
  "island-owners",
  "audio",
  "renderer",
  "debug"
];

export interface IslandTeardownStep {
  dispose: () => Promise<void> | void;
  /** Stable insertion order is kept within one phase. */
  name: string;
  phase: IslandTeardownPhase;
}

export interface IslandTeardownResult {
  completed: readonly string[];
  errors: ReadonlyArray<{ error: unknown; name: string }>;
}

/**
 * Runs every island owner once, sequentially and in phase order. One failing owner never blocks the
 * remaining release steps. The first `run()` promise is retained so repeated teardown (for example a
 * failed install followed by a reload) cannot dispose an owner twice.
 */
export const createIslandTeardown = (steps: readonly IslandTeardownStep[]) => {
  const ordered = steps.map((step, index) => ({ ...step, index })).sort((left, right) =>
    PHASE_ORDER.indexOf(left.phase) - PHASE_ORDER.indexOf(right.phase) || left.index - right.index
  );
  let running: Promise<IslandTeardownResult> | undefined;
  const run = () => {
    running ??= (async () => {
      const completed: string[] = [];
      const errors: Array<{ error: unknown; name: string }> = [];
      for (const step of ordered) {
        try {
          await step.dispose();
          completed.push(step.name);
        } catch (error) {
          errors.push({ error, name: step.name });
        }
      }
      return { completed, errors };
    })();
    return running;
  };
  return { run, steps: () => ordered.map(({ name, phase }) => ({ name, phase })) };
};

export type IslandTeardown = ReturnType<typeof createIslandTeardown>;
