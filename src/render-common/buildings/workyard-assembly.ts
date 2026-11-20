import type { BuildingPart } from "./building-recipe";

/** Names an existing productive assembly so a redesign replaces it once, without guessing by colour. */
export const authorWorkyardAssembly = <T>(parts: BuildingPart[], assembly: string, author: () => T): T => {
  const first = parts.length;
  const result = author();
  for (let index = first; index < parts.length; index++) parts[index]!.workyardAssembly = assembly;
  return result;
};
