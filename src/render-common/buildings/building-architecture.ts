import type { BuildingPart } from "./building-recipe";

/** Mark authored shell parts while preserving operational inventory in mixed assemblies. */
export const authorBuildingArchitecture = <T>(parts: BuildingPart[], author: () => T): T => {
  const first = parts.length;
  const result = author();
  for (let index = first; index < parts.length; index++) {
    const part = parts[index]!;
    if (!part.stock) part.architecture = true;
  }
  return result;
};
