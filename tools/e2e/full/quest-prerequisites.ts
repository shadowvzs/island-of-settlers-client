import { MissingPrerequisite } from "./report";

/** Only absent scenario setup is blocked; observed incorrect progression stays a failure. */
export const requireQuestPrerequisite: (condition: unknown, reason: string) => asserts condition = (
  condition,
  reason
) => {
  if (!condition) throw new MissingPrerequisite(reason);
};
