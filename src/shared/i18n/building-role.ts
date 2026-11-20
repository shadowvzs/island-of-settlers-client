import type { I18n } from "@lingui/core";
import { buildingRoleText } from "@shared/catalog/building-data/rules";

import { contentDescriptor } from "./content-text";
import { translateMessage } from "./translate";

/**
 * What a building does, as the nation shows it (rules sidecar `role`, drink chain slots per nation). Kept out of
 * `domain.ts`: the rules sidecars belong to the simulation chunk, not to the first screen.
 */
export const displayBuildingRole = (typeId: number, nation?: string, i18n?: I18n) => {
  const text = buildingRoleText(typeId, nation);
  return text ? translateMessage(i18n, contentDescriptor(text)) : "";
};
