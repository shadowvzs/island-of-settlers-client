import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

/** Optional native-review artifacts; ordinary test runs never write generated saves into the repo. */
export const exportEconomySaveFixture = async (name: string, save: GameSaveV1) => {
  const folder = process.env.ECONOMY_SAVE_FIXTURE_OUTPUT;
  if (!folder) return;
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, `${name}.json`), JSON.stringify(save));
};
