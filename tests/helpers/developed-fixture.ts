import { readFile } from "node:fs/promises";

import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

/**
 * The developed demo save predates Wildlife 2.0. Its animal blob cannot be restored by the current
 * loader, so parity fixtures drop it and let the island initialise a current wildlife manager.
 * The public demo itself still needs a full wildlife migration; this keeps the parity tests honest
 * about the settlement/navigation state they actually exercise.
 */
export const readDevelopedFixture = async (): Promise<GameSaveV1> => {
  const save = JSON.parse(await readFile(new URL("../../public/demo/continued-0.json", import.meta.url), "utf8")) as GameSaveV1;
  if (save.runtime && typeof save.runtime === "object" && "animals" in save.runtime) {
    delete (save.runtime as { animals?: unknown }).animals;
  }
  return save;
};
