import { TRIPO_ROSTER } from "@workers/tripo-roster";

import { settlerNation, type WorkerNation } from "./worker-nation";

/** Body identity follows the published roster; old explicit body IDs retain their original owner. */
export const workerBodyNation = (
  nation: WorkerNation,
  variant?: string
): keyof typeof TRIPO_ROSTER => {
  const own = nation in TRIPO_ROSTER ? nation as keyof typeof TRIPO_ROSTER : settlerNation(nation);
  if (!variant) return own;
  const roster = TRIPO_ROSTER[own];
  if (([...roster.female, ...roster.male] as readonly string[]).includes(variant)) return own;
  const legacy = settlerNation(nation), previous = TRIPO_ROSTER[legacy];
  return ([...previous.female, ...previous.male] as readonly string[]).includes(variant) ? legacy : own;
};
