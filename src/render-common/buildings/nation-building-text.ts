import { buildingEntry, settlerJob } from "@shared/catalog";
import { buildingRules } from "@shared/catalog/building-data/rules";

import { type BuildingDefinition, getBuildingDefinition } from "./building-catalog";

/** The nation's variant of a building (rules sidecar `nations.<nation>`): name, role, worker and output shelf. */
const nationOverride = (definition: BuildingDefinition, nation: string): Partial<BuildingDefinition> => {
  const variant = buildingRules(definition.id)?.nations?.[nation];
  if (!variant) return {};
  const production = variant.production;
  return {
    name: buildingEntry(definition.id)!.text.variants![nation]!.en,
    ...(variant.role ? { role: variant.role.en } : {}),
    ...(production ? { worker: settlerJob(production.job) } : {}),
    ...(production && definition.outputStorage
      ? { outputStorage: { ...definition.outputStorage, goods: production.outputs } } : {})
  };
};

const cache = new Map<string, BuildingDefinition>();

/**
 * The catalog entry as the given nation shows it: building slots 5 and 6 follow the nation's drink
 * chain. Footprints and models stay those of the shared slot.
 */
export const getNationBuildingDefinition = (id: number, nation: string = "roman"): BuildingDefinition => {
  const key = `${nation}:${id}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const definition = getBuildingDefinition(id);
  const override = nationOverride(definition, nation);
  const result = Object.keys(override).length ? Object.assign(Object.create(definition), override) : definition;
  cache.set(key, result);
  return result;
};
