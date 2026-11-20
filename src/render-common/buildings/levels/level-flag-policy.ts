import { BuildingType } from "../../../shared/settlement/building-type-ids";

/**
 * Owner rule 2026-11-08: flags, banners, war standards and flag-like poles or vanes belong only on
 * military buildings and the headquarters. Civilian level steps add real building improvements.
 * Owner 2026-11-09: the Military Academy and the Commander's Lodge are military buildings too
 * (soldiers come out of them), so they level up with the military steps and may carry banners.
 */
export const FLAG_BEARING_BUILDINGS: ReadonlySet<number> = new Set([
  BuildingType.Headquarters, BuildingType.Barracks, BuildingType.Guardhouse, BuildingType.Watchtower,
  BuildingType.Fortress, BuildingType.LookoutTower, BuildingType.Catapult, BuildingType.MilitaryAcademy,
  BuildingType.CommandersLodge
]);

/** True when level art of this building type may carry a flag, banner, standard or vane. */
export const mayCarryFlag = (definitionId: number) => FLAG_BEARING_BUILDINGS.has(definitionId);
