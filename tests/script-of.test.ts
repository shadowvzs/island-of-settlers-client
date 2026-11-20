import { expect, it } from "vitest";

import { readyMap } from "../../island-of-settlers-shared/tests/campaign-fixtures";
import { plantTrees } from "../../island-of-settlers-shared/tests/script-fixtures";
import { scriptOf } from "../src/shared/world/script-of";

it("resolves the file script first, then a campaign record's script, else none", () => {
  const fileScript = plantTrees();
  expect(scriptOf({ script: fileScript }, readyMap())).toBe(fileScript);
  const recordScript = scriptOf({}, readyMap())!;
  expect(recordScript.quests.quests.map(quest => quest.id)).toEqual(["q-intro", "q-gate"]);
  expect(Object.isFrozen(recordScript)).toBe(true);
  expect(scriptOf({}, readyMap({ quests: [], regions: [] }))).toBeNull();
  expect(scriptOf({})).toBeNull();
});
