import { loadCritterSpecies } from "../../src/render-common/critters/critter-models";
import { CRITTER } from "../../src/render-common/critters/critter-species";
import { readCritterGlbFromDisk } from "../helpers/critter-glbs";

/** The game loads the critter models of the species an island spawns; tests use every species. */
await loadCritterSpecies(Object.values(CRITTER), readCritterGlbFromDisk);
