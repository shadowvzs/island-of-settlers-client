/** An undo step: what it keeps in memory counts against the budget. */
export interface UndoStep {
  bytes: number;
}

export interface UndoLimits {
  /** Memory budget of every kept step together (the oldest steps go first). */
  maxBytes: number;
  maxSteps: number;
}

/**
 * Undo and redo steps with a step and a memory cap (the oldest undo steps are dropped first).
 * A new step clears the redo steps.
 */
export const createUndoStack = <Step extends UndoStep>(limits: UndoLimits) => {
  const undoSteps: Step[] = [];
  let redoSteps: Step[] = [];

  const countBytes = () => [...undoSteps, ...redoSteps].reduce((sum, step) => sum + step.bytes, 0);

  const trim = () => {
    while (undoSteps.length > limits.maxSteps) undoSteps.shift();
    while (undoSteps.length > 1 && countBytes() > limits.maxBytes) undoSteps.shift();
  };

  return {
    canRedo: () => redoSteps.length > 0,
    canUndo: () => undoSteps.length > 0,
    countBytes,
    countSteps: () => undoSteps.length,
    push: (step: Step) => {
      undoSteps.push(step);
      redoSteps = [];
      trim();
    },
    /** The step to redo (moved back to the undo steps), or null. */
    redo: () => {
      const step = redoSteps.pop();
      if (!step) return null;
      undoSteps.push(step);
      return step;
    },
    /** The step to undo (moved to the redo steps), or null. */
    undo: () => {
      const step = undoSteps.pop();
      if (!step) return null;
      redoSteps.push(step);
      return step;
    }
  };
};
