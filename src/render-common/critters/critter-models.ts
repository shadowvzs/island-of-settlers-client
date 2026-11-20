import { CRITTER, type CritterId } from "./critter-species";
import { createBearModel } from "./model/bear";
import { createBoarModel, createPigletModel } from "./model/boar";
import { createChamoisModel } from "./model/chamois";
import { createCrabModel } from "./model/crab";
import { CRITTER_GLB, type CritterGlbFetch, isCritterGlbLoaded, loadCritterGlb } from "./model/critter-glbs";
import type { CritterModel } from "./model/critter-model";
import { createDragonflyModel } from "./model/dragonfly";
import { createEagleModel } from "./model/eagle";
import { createFishModel, RIVER_TROUT, SEA_MACKEREL } from "./model/fish";
import { createFoxModel } from "./model/fox";
import { createFrogModel } from "./model/frog";
import { createHedgehogModel } from "./model/hedgehog";
import { createHeronModel } from "./model/heron";
import { createMallardModels } from "./model/mallard";
import { createBurrowModel, createMarmotModel } from "./model/marmot";
import { createSealModel } from "./model/seal";
import { createSquirrelModel } from "./model/squirrel";
import { createGullModel } from "./model/wader-models";
import { createWolfModel } from "./model/wolf";

/** Season and detail of a critter model: the cosmetic winter recolours the fur, Minimal halves the triangles. */
interface CritterVariant {
  minimal: boolean;
  winter: boolean;
}

/** How a species' model is built, and the shipped GLBs it needs first (none: built in code). */
interface CritterModelSource {
  build: (variant: CritterVariant) => CritterModel;
  glbs: readonly string[];
}

let mallards: ReturnType<typeof createMallardModels> | undefined;
/** The drake, the hen and the ducklings come from one posed mesh (the same in every variant). */
const getMallards = () => (mallards ??= createMallardModels());

const codeBuilt = (build: () => CritterModel): CritterModelSource => ({ build, glbs: [] });

const SOURCES: Record<keyof typeof CRITTER, CritterModelSource> = {
  bear: { build: ({ minimal }) => createBearModel(minimal), glbs: [CRITTER_GLB.bear] },
  boar: { build: ({ minimal, winter }) => createBoarModel(minimal, winter), glbs: [CRITTER_GLB.boar] },
  burrow: codeBuilt(createBurrowModel),
  chamois: {
    build: ({ minimal, winter }) => createChamoisModel({ kid: false, minimal, winter }),
    glbs: [CRITTER_GLB.chamois]
  },
  chamoisKid: {
    build: ({ minimal, winter }) => createChamoisModel({ kid: true, minimal, winter }),
    glbs: [CRITTER_GLB.chamois]
  },
  crab: codeBuilt(createCrabModel),
  dragonfly: codeBuilt(createDragonflyModel),
  duckling: { build: () => getMallards().duckling, glbs: [CRITTER_GLB.mallard] },
  eagle: { build: ({ minimal }) => createEagleModel(minimal), glbs: [CRITTER_GLB.eagle] },
  fox: { build: ({ minimal, winter }) => createFoxModel(minimal, winter), glbs: [CRITTER_GLB.fox] },
  frog: codeBuilt(createFrogModel),
  gull: codeBuilt(createGullModel),
  hedgehog: codeBuilt(createHedgehogModel),
  heron: { build: ({ minimal }) => createHeronModel(minimal), glbs: [CRITTER_GLB.heron] },
  mackerel: codeBuilt(() => createFishModel(SEA_MACKEREL)),
  mallardDrake: { build: () => getMallards().drake, glbs: [CRITTER_GLB.mallard] },
  mallardHen: { build: () => getMallards().hen, glbs: [CRITTER_GLB.mallard] },
  marmot: codeBuilt(createMarmotModel),
  piglet: { build: ({ minimal }) => createPigletModel(minimal), glbs: [CRITTER_GLB.piglet] },
  seal: { build: ({ minimal }) => createSealModel(minimal), glbs: [CRITTER_GLB.seal] },
  squirrel: { build: createSquirrelModel, glbs: [CRITTER_GLB.squirrel] },
  trout: codeBuilt(() => createFishModel(RIVER_TROUT)),
  wolf: { build: ({ minimal, winter }) => createWolfModel(minimal, winter), glbs: [CRITTER_GLB.wolf] }
};

/** The sources in CRITTER id order (critter-species.ts). */
const SOURCE_BY_ID: readonly CritterModelSource[] = Object.entries(CRITTER)
  .sort(([, a], [, b]) => a - b)
  .map(([key]) => SOURCES[key as keyof typeof CRITTER]);

const models = new Map<string, CritterModel>();

/** Whether the species' shipped files are loaded (code-built species always are). */
export const isCritterSpeciesLoaded = (species: number) =>
  SOURCE_BY_ID[species]?.glbs.every(isCritterGlbLoaded) === true;

/**
 * Loads the shipped files of the given species (each file once, in parallel) and resolves with
 * the species whose models can now be built; a species whose file failed is left out (warned once).
 */
export const loadCritterSpecies = async (
  species: Iterable<number>,
  fetchGlb?: CritterGlbFetch
): Promise<CritterId[]> => {
  const wanted = [...new Set(species)].filter((id) => SOURCE_BY_ID[id] !== undefined);
  const urls = new Set(wanted.flatMap((id) => SOURCE_BY_ID[id]!.glbs));
  await Promise.all([...urls].map((url) => loadCritterGlb(url, fetchGlb)));
  return wanted.filter(isCritterSpeciesLoaded) as CritterId[];
};

/**
 * A species' posed frames in the season's coat at a detail level (built once per combination on
 * first use; pure, also in workers and tests); undefined while its shipped file is not loaded.
 */
export const getCritterModel = (species: number, winter = false, minimal = false): CritterModel | undefined => {
  if (!isCritterSpeciesLoaded(species)) return undefined;
  const key = `${species}-${winter ? "winter" : "summer"}-${minimal ? "minimal" : "high"}`;
  let model = models.get(key);
  if (!model) {
    model = SOURCE_BY_ID[species]!.build({ minimal, winter });
    models.set(key, model);
  }
  return model;
};

/** Every species' model in CRITTER id order (tests: every species must be loaded first). */
export const getCritterModels = (winter = false, minimal = false): readonly CritterModel[] =>
  SOURCE_BY_ID.map((_, species) => {
    const model = getCritterModel(species, winter, minimal);
    if (!model) throw new Error(`Critter species ${species} is not loaded`);
    return model;
  });
