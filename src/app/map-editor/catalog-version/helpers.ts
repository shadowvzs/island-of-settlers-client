/** A loaded map authored with another content catalog version than the running game. */
export interface CatalogVersionWarning {
  gameVersion: string;
  mapVersion: string;
}

/**
 * The warning for a loaded map whose stored content catalog version differs from the game's; null for a
 * matching version and for generated islands or older files that stored none.
 */
export const getCatalogVersionWarning = (
  mapVersion: string | undefined, gameVersion: string
): CatalogVersionWarning | null => {
  if (mapVersion === undefined || mapVersion === gameVersion) return null;
  return { gameVersion, mapVersion };
};
