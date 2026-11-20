import { isHomeBuilding, isOwnHeadquarters } from "./settlement-home";
/** One stock read for each saved pool, while unpooled authored sources stay independent. */
export const uniquePoolSources = <T extends { storagePoolId?: number }>(sources: readonly T[]): T[] => {
  const seen = new Set<number>();
  return sources.filter(source => {
    if (source.storagePoolId === undefined) return true;
    if (seen.has(source.storagePoolId)) return false;
    seen.add(source.storagePoolId);
    return true;
  });
};

/** Abstract colony stock operations spend one actual home pool, never all pools in a world record. */
export const homePoolSources = <T extends { colonyHome?: boolean; storagePoolId?: number; typeId: number }>(
  sources: readonly T[]
): T[] => {
  const home = sources.find(isOwnHeadquarters) ?? sources.find(isHomeBuilding);
  if (!home) return sources.some(source => source.storagePoolId !== undefined) ? [] : uniquePoolSources(sources);
  if (home.storagePoolId === undefined) return uniquePoolSources(sources);
  return uniquePoolSources(sources.filter(source => source.storagePoolId === home.storagePoolId));
};
