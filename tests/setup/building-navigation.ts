import { buildingNavigationNations, loadBuildingNavigation } from "@shared/catalog/building-data/navigation";

/** The game loads a nation's building navigation before its simulation starts; tests use every nation. */
await Promise.all(buildingNavigationNations().map(loadBuildingNavigation));
