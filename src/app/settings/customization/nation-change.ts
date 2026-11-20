import type { WorkerNation } from "../../../render-common/workers/worker-unit";

interface PreparedNation { commit: () => boolean; dispose: () => void }
interface NationChangeOptions {
  apply: () => void;
  consume: () => Promise<true | string>;
  current: WorkerNation;
  hasItem: () => boolean;
  next: WorkerNation;
  prepare: () => Promise<PreparedNation | null>;
  validate: () => boolean;
}

/** Load/validate first. Only a confirmed purchase receipt permits publishing the prepared nation. */
export const applyPaidNationChange = async ({
  apply, consume, current, hasItem, next, prepare, validate
}: NationChangeOptions) => {
  if (current === next) return;
  if (!hasItem()) throw new Error("A Choose nation item is required");
  if (!validate()) throw new Error("Nation replacement failed");
  const prepared = await prepare();
  if (!prepared) throw new Error("Worker replacement failed");
  try {
    if (!validate()) throw new Error("Nation replacement failed");
    const result = await consume();
    if (result !== true) throw new Error(result);
    // The receipt is authoritative even if the old scene was torn down while awaiting it.
    // Never publish into that scene or imply that the consumed item was retained.
    try {
      if (!validate() || !prepared.commit()) throw new Error("Worker replacement failed");
      apply();
    } catch {
      throw new Error("Nation change confirmed; reload to finish");
    }
  } finally { prepared.dispose(); }
};

interface DebugNationChangeOptions {
  allowed: boolean;
  apply: () => void;
  current: WorkerNation;
  next: WorkerNation;
  prepare: () => Promise<PreparedNation | null>;
  validate: () => boolean;
}

/** Authorized testing has no inventory dependency and never touches the paid account preference. */
export const applyDebugNationChange = async ({
  allowed, apply, current, next, prepare, validate
}: DebugNationChangeOptions) => {
  if (!allowed) throw new Error("Development access is required");
  if (current === next) return;
  if (!validate()) throw new Error("Nation replacement failed");
  const prepared = await prepare();
  if (!prepared) throw new Error("Worker replacement failed");
  try {
    if (!validate()) throw new Error("Nation replacement failed");
    if (!prepared.commit()) throw new Error("Worker replacement failed");
    apply();
  } finally { prepared.dispose(); }
};
