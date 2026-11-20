import { msg } from "@lingui/core/macro";

/** Map generator panel copy; resolved through the selected Lingui locale at render time. */
export const MAP_GENERATOR_MESSAGES = {
  amount: {
    few: msg({ id: "mapGenerator.amount.few", message: "Few" }),
    many: msg({ id: "mapGenerator.amount.many", message: "Many" }),
    none: msg({ id: "mapGenerator.amount.none", message: "None" }),
    normal: msg({ id: "mapGenerator.amount.normal", message: "Normal" }),
    veryMany: msg({ id: "mapGenerator.amount.veryMany", message: "Very many" })
  },
  button: {
    recreate: msg({ id: "mapGenerator.button.recreate", message: "Recreate island" })
  },
  current: {
    forest: msg({ id: "settlement.climate.forest", message: "Forest" }),
    fromSeed: msg({ id: "mapGenerator.current.fromSeed", message: "{name} (from seed)" }),
    landform: msg({ id: "mapGenerator.form.landform", message: "Landform" }),
    loadedIn: msg({ id: "mapGenerator.current.loadedIn", message: "Loaded in" }),
    mountains: msg({ id: "mapGenerator.form.mountains", message: "Mountains" }),
    terrainVariation: msg({ id: "mapGenerator.form.terrainVariation", message: "Terrain variation" }),
    newIsland: msg({ id: "mapGenerator.current.newIsland", message: "New island" }),
    resources: msg({ id: "settlement.gemShop.categoryResources", message: "Resources" }),
    rivers: msg({ id: "mapGenerator.form.rivers", message: "Rivers" }),
    seed: msg({ id: "mapGenerator.current.seed", message: "Seed" }),
    size: msg({ id: "mapGenerator.current.size", message: "Size" }),
    theme: msg({ id: "mapGenerator.form.theme", message: "Theme" }),
    title: msg({ id: "mapGenerator.current.title", message: "Current island" })
  },
  form: {
    cliffBands: msg({ id: "mapGenerator.form.cliffBands", message: "Tall cliff bands" }),
    cliffBandsTitle: msg({
      id: "mapGenerator.form.cliffBandsTitle",
      message: "Terraced land steps by three levels at once: walls that block movement, with ramps between them"
    }),
    forest: msg({ id: "settlement.climate.forest", message: "Forest" }),
    forestDensity: msg({ id: "mapGenerator.form.forestDensity", message: "Forest density" }),
    harbourSpots: msg({ id: "mapGenerator.form.harbourSpots", message: "Potential harbour spots" }),
    harbourSpotsTitle: msg({
      id: "mapGenerator.form.harbourSpotsTitle",
      message: "Store a few checked, pre-levelled harbour spots on every island; harbour building and expeditions try them first"
    }),
    height: msg({ id: "mapGenerator.form.height", message: "Height" }),
    islandCount: msg({ id: "mapGenerator.form.islandCount", message: "Number of islands" }),
    landform: msg({ id: "mapGenerator.form.landform", message: "Landform" }),
    mountains: msg({ id: "mapGenerator.form.mountains", message: "Mountains" }),
    peaks: msg({ id: "mapGenerator.form.peaks", message: "Peaks" }),
    terrainVariation: msg({ id: "mapGenerator.form.terrainVariation", message: "Terrain variation" }),
    recreateTitle: msg({
      id: "mapGenerator.form.recreateTitle",
      message: "Generate an island with these options and seed, or a random seed when empty (reloads the page)"
    }),
    requirements: msg({
      id: "mapGenerator.form.requirements",
      message: "Each island has at least four connected 5×5 building plots, plus HQ, harbour and roads."
    }),
    relief: msg({ id: "mapGenerator.form.relief", message: "Mountain relief" }),
    rivers: msg({ id: "mapGenerator.form.rivers", message: "Rivers" }),
    seedLabel: msg({ id: "mapGenerator.form.seedLabel", message: "Seed (optional)" }),
    seedTitle: msg({
      id: "mapGenerator.form.seedTitle",
      message: "Whole number from 0 to 4294967295. Leave empty for a new random island."
    }),
    similarSizes: msg({ id: "mapGenerator.form.similarSizes", message: "Mostly similar island sizes" }),
    theme: msg({ id: "mapGenerator.form.theme", message: "Theme" }),
    themes: msg({ id: "mapGenerator.form.themes", message: "Themes" }),
    width: msg({ id: "mapGenerator.form.width", message: "Width" })
  },
  landform: {
    archipelago: msg({ id: "mapGenerator.landform.archipelago", message: "Islands" }),
    peninsula: msg({ id: "mapGenerator.landform.peninsula", message: "Peninsula" }),
    random: msg({ id: "mapGenerator.landform.random", message: "Random" })
  },
  peaks: {
    classic: msg({ id: "mapGenerator.peaks.classic", message: "Classic" }),
    tall: msg({ id: "mapGenerator.peaks.tall", message: "Tall (steep summits, default)" })
  },
  forestDensity: {
    dense: msg({ id: "mapGenerator.forestDensity.dense", message: "Dense" }),
    normal: msg({ id: "mapGenerator.forestDensity.normal", message: "Normal (default)" }),
    veryDense: msg({ id: "mapGenerator.forestDensity.veryDense", message: "Very dense" })
  },
  relief: {
    eroded: msg({ id: "mapGenerator.relief.eroded", message: "Eroded (carved valleys, default)" }),
    massif: msg({ id: "mapGenerator.relief.massif", message: "Massif" })
  },
  terrainVariation: {
    flat: msg({ id: "mapGenerator.terrainVariation.flat", message: "Flat" }),
    rolling: msg({ id: "mapGenerator.terrainVariation.rolling", message: "Gently rolling" }),
    natural: msg({ id: "mapGenerator.terrainVariation.natural", message: "Natural (default)" }),
    hilly: msg({ id: "mapGenerator.terrainVariation.hilly", message: "Hilly" }),
    veryHilly: msg({ id: "mapGenerator.terrainVariation.veryHilly", message: "Very hilly" })
  },
  layout: {
    altitude: msg({ id: "mapGenerator.layout.altitude", message: "Altitude bands" }),
    landmass: msg({ id: "mapGenerator.layout.landmass", message: "One per island" }),
    latitude: msg({ id: "mapGenerator.layout.latitude", message: "Latitude bands" }),
    regions: msg({ id: "mapGenerator.layout.regions", message: "Natural regions" }),
    uniform: msg({ id: "mapGenerator.layout.uniform", message: "One theme" })
  },
  no: msg({ id: "mapGenerator.no", message: "No" }),
  resource: {
    colony: msg({ id: "mapGenerator.resource.colony", message: "Colony · Tier {tier} — {wood} and {stone}" }),
    home: msg({
      id: "mapGenerator.resource.home",
      message: "Home · Tier 0 — pine/palm softwood and stone"
    })
  },
  river: {
    few: msg({ id: "mapGenerator.amount.few", message: "Few" }),
    normal: msg({ id: "mapGenerator.river.normal", message: "Normal" }),
    off: msg({ id: "mapGenerator.river.off", message: "Off" })
  },
  stone: {
    basalt: msg({ id: "domain.material.basalt", message: "basalt" }),
    granite: msg({ id: "domain.material.granite", message: "granite" }),
    limestone: msg({ id: "domain.material.limestone", message: "limestone" }),
    marble: msg({ id: "domain.material.marble", message: "marble" }),
    stone: msg({ id: "domain.material.stone", message: "stone" })
  },
  theme: {
    desert: msg({ id: "mapGenerator.theme.desert", message: "Desert / sandy" }),
    dirt: msg({ id: "mapGenerator.theme.dirt", message: "Dirt / steppe" }),
    meadow: msg({ id: "mapGenerator.theme.meadow", message: "Meadow" }),
    snowy: msg({ id: "mapGenerator.theme.snowy", message: "Snowy" })
  },
  wood: {
    cedar: msg({ id: "domain.material.cedar", message: "cedar" }),
    hardwood: msg({ id: "domain.material.hardwood", message: "hardwood" }),
    mahogany: msg({ id: "domain.material.mahogany", message: "mahogany" }),
    softwood: msg({ id: "domain.material.softwood", message: "softwood" }),
    walnut: msg({ id: "mapGenerator.wood.walnut", message: "walnut" })
  },
  yes: msg({ id: "mapGenerator.yes", message: "Yes" })
} as const;
