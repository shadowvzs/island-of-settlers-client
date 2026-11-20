import { msg } from "@lingui/core/macro";

/** Frozen Settings copy: tab, option, help and validation text of the settled panels. */
export const SETTINGS_MESSAGES = {
  account: {
    title: msg({ id: "settings.account.title", message: "Account" })
  },
  daylight: {
    alwaysDay: msg({ id: "settings.daylight.alwaysDay", message: "Always day" }),
    alwaysDayTitle: msg({
      id: "settings.daylight.alwaysDayTitle",
      message: "Keep a clear noon: no cycle and no random weather."
    }),
    group: msg({ id: "settings.daylight.group", message: "Day and weather" }),
    hint: msg({
      id: "settings.daylight.hint",
      message: "Nature (realistic) follows sunrise, sunset and the moon, and may bring rain. A full day takes 72 minutes; night is compressed to 16.5 minutes. Always day keeps a clear noon without random weather."
    }),
    nature: msg({ id: "settings.daylight.nature", message: "Nature (realistic)" }),
    natureTitle: msg({
      id: "settings.daylight.natureTitle",
      message: "Natural, realistic day and night cycle with occasional rain (snowy islands keep their winter weather)."
    }),
    title: msg({ id: "settings.daylight.title", message: "Daylight" })
  },
  graphics: {
    ambientOcclusion: msg({ id: "settings.graphics.ambientOcclusion", message: "Ambient occlusion" }),
    ambientOcclusionChoice: {
      off: msg({ id: "settings.graphics.ambientOcclusion.off", message: "Off" }),
      soft: msg({ id: "settings.graphics.ambientOcclusion.soft", message: "Soft" }),
      strong: msg({ id: "settings.graphics.ambientOcclusion.strong", message: "Strong" }),
      dramatic: msg({ id: "settings.graphics.ambientOcclusion.dramatic", message: "Dramatic" })
    },
    ambientOcclusionCost: msg({
      id: "settings.graphics.ambientOcclusion.cost",
      message: "Contact shadows where surfaces meet: under eaves, at building feet and between trees. Soft is subtle; Strong is clearly darker and deeper; Dramatic also darkens sunlit surfaces. All at the same cost. Medium and High only; needs a colour buffer other than Off. Small GPU cost."
    }),
    applyCharacterDetail: msg({
      id: "settings.graphics.applyCharacterDetail",
      message: "Apply character detail"
    }),
    applyDetail: msg({
      id: "settings.graphics.applyDetail",
      message: "Apply detail (rebuilds the island in place)"
    }),
    applyResolution: msg({ id: "settings.graphics.applyResolution", message: "Apply resolution" }),
    autoExposure: msg({ id: "settings.graphics.autoExposure", message: "Eye adaptation" }),
    autoExposureHint: msg({
      id: "settings.graphics.autoExposure.hint",
      message: "How strongly the first-person eye adapts its exposure: brighter in shade and interiors, slightly darker in glaring light. 0 % keeps a fixed exposure at no cost, 100 % is the standard look. Very small GPU cost."
    }),
    iceFloesNeedsLevel: msg({
      id: "settings.graphics.toggle.iceFloes.needsLevel",
      message: "Available on the Medium and High detail levels only."
    }),
    autoExposureNeedsLevel: msg({
      id: "settings.graphics.autoExposure.needsLevel",
      message: "Available on the Medium and High detail levels only."
    }),
    bloom: msg({ id: "settings.graphics.bloom", message: "Bloom" }),
    bloomChoice: {
      low: msg({ id: "settings.graphics.bloom.low", message: "Soft" }),
      off: msg({ id: "settings.graphics.bloom.off", message: "Off" }),
      on: msg({ id: "settings.graphics.bloom.on", message: "Full" })
    },
    bloomCost: msg({
      id: "settings.graphics.bloom.cost",
      message: "Soft glow around bright highlights: sun glints on water, the sunset sky, night windows and fire. Needs a colour buffer other than Off. Low to medium GPU cost."
    }),
    characterDetail: msg({ id: "settings.graphics.characterDetail", message: "Character detail" }),
    characterDetailChoice: {
      auto: msg({
        id: "settings.graphics.characterDetail.auto",
        message: "Auto (follows Detail)"
      }),
      high: msg({ id: "settings.graphics.detail.high", message: "High" }),
      low: msg({ id: "settings.graphics.detail.low", message: "Low" }),
      medium: msg({ id: "settings.graphics.detail.medium", message: "Medium" }),
      minimal: msg({ id: "settings.graphics.detail.minimal", message: "Minimal" })
    },
    characterDetailHint: msg({
      id: "settings.graphics.characterDetailHint",
      message: "How detailed settler models are and how often they are posed. The ✓ applies it immediately without a reload; the Detail level still sets the finest models it loads."
    }),
    colourPrecision: msg({ id: "settings.graphics.colourPrecision", message: "Colour precision" }),
    colourPrecisionChoice: {
      off: msg({ id: "settings.graphics.colourPrecision.off", message: "Off (direct)" }),
      rgba16f: msg({ id: "settings.graphics.colourPrecision.rgba16f", message: "High 16-bit" }),
      rgba8: msg({ id: "settings.graphics.colourPrecision.rgba8", message: "Standard 8-bit" })
    },
    colourPrecisionCost: msg({
      id: "settings.graphics.colourPrecision.cost",
      message: "Precision of the scene colour buffer. High 16-bit costs about +1.2 ms GPU on a mid-range GPU and prepares bloom and auto-exposure; the look stays the same today. Standard 8-bit is free; Off draws straight to the screen where the Detail level does."
    }),
    detail: msg({ id: "settings.graphics.detail", message: "Detail" }),
    detailHelp: msg({
      id: "settings.graphics.detailHelp",
      message: "High: everything on. Minimal: no sun shadows, no water refraction, flat trees, no grass, no rain / snow particles, simpler ground. Apply (✓) rebuilds the island in place and keeps your save."
    }),
    detailLevel: {
      high: msg({ id: "settings.graphics.detail.high", message: "High" }),
      low: msg({ id: "settings.graphics.detail.low", message: "Low" }),
      medium: msg({ id: "settings.graphics.detail.medium", message: "Medium" }),
      minimal: msg({ id: "settings.graphics.detail.minimal", message: "Minimal" })
    },
    detailRecommended: msg({
      id: "settings.graphics.detail.recommended",
      message: "{level} (recommended)"
    }),
    highlights: msg({ id: "settings.graphics.highlights", message: "Highlights / glare" }),
    highlightsHint: msg({
      id: "settings.graphics.highlightsHint",
      message: "How strongly sun glints on water, bright surf foam, shiny highlights and the bloom glow shine. Lower it if bright spots dazzle; surfaces stay lit. Applied immediately, no performance cost."
    }),
    lawnDepth: msg({ id: "settings.graphics.lawnDepth", message: "Lawn depth" }),
    lawnDepthChoice: {
      normal: msg({ id: "settings.graphics.lawnDepth.normal", message: "Normal" }),
      off: msg({ id: "settings.graphics.lawnDepth.off", message: "Off" }),
      strong: msg({ id: "settings.graphics.lawnDepth.strong", message: "Strong" })
    },
    lawnDepthCost: msg({
      id: "settings.graphics.lawnDepth.cost",
      message: "How deeply dense meadow reads: Normal and Strong darken the clumps and cut their sky light. Off keeps the plain ground and skips its texture fetch. Low GPU cost."
    }),
    resolution: msg({ id: "settings.graphics.resolution", message: "Resolution" }),
    resolutionChoice: {
      auto: msg({ id: "settings.graphics.resolution.auto", message: "Auto (lighter on phones)" }),
      balanced: msg({ id: "settings.graphics.resolution.balanced", message: "Balanced" }),
      fast: msg({ id: "settings.graphics.resolution.fast", message: "Fast" }),
      sharp: msg({ id: "settings.graphics.resolution.sharp", message: "Sharp (native)" })
    },
    resolutionHint: msg({
      id: "settings.graphics.resolutionHint",
      message: "Resolution changes that keep antialiasing apply immediately; antialiasing changes reload the game."
    }),
    title: msg({ id: "settings.tabs.graphics", message: "Graphics" }),
    toggleHint: msg({
      id: "settings.graphics.toggleHint",
      message: "Moving the Detail slider resets these to that level's defaults. Changes apply with the ✓ above (rebuilds the island in place, keeps your save)."
    }),
    toggles: {
      animalSilhouettes: {
        label: msg({ id: "settings.graphics.toggle.animalSilhouettes", message: "Animals through trees and hills" }),
        cost: msg({
          id: "settings.graphics.toggle.animalSilhouettes.cost",
          message: "An extra pass over the animals. Low GPU cost."
        })
      },
      atmosphere: {
        label: msg({ id: "settings.graphics.toggle.atmosphere", message: "Atmospheric haze" }),
        cost: msg({
          id: "settings.graphics.toggle.atmosphere.cost",
          message: "Distance haze in the strategic view. Low GPU cost."
        })
      },
      atmosphereBanks: {
        label: msg({ id: "settings.graphics.toggle.atmosphereBanks", message: "Drifting mist banks" }),
        cost: msg({
          id: "settings.graphics.toggle.atmosphereBanks.cost",
          message: "Two animated mist layers over the island in the strategic view. Low to medium GPU cost."
        })
      },
      grass: {
        label: msg({ id: "settings.graphics.toggle.grass", message: "Grass" }),
        cost: msg({
          id: "settings.graphics.toggle.grass.cost",
          message: "Grass tufts on open ground. Medium GPU cost."
        })
      },
      refraction: {
        label: msg({ id: "settings.graphics.toggle.refraction", message: "Water refraction" }),
        cost: msg({
          id: "settings.graphics.toggle.refraction.cost",
          message: "An extra pass that draws the seabed through the water. Medium GPU cost."
        })
      },
      rockDetail: {
        label: msg({ id: "settings.graphics.toggle.rockDetail", message: "Detailed rocks" }),
        cost: msg({
          id: "settings.graphics.toggle.rockDetail.cost",
          message: "Detail normals, grain and cracks on rocks. Low to medium GPU cost."
        })
      },
      skyEnvironment: {
        label: msg({ id: "settings.graphics.toggle.skyEnvironment", message: "Sky reflections" }),
        cost: msg({
          id: "settings.graphics.toggle.skyEnvironment.cost",
          message: "Metals and sheen on buildings reflect the sky. Low GPU cost."
        })
      },
      iceFloes: {
        label: msg({ id: "settings.graphics.toggle.iceFloes", message: "Ice floes" }),
        cost: msg({
          id: "settings.graphics.toggle.iceFloes.cost",
          message: "Floating 3D ice floes along winter coasts. Low GPU cost."
        })
      },
      sunShadows: {
        label: msg({ id: "settings.graphics.toggle.sunShadows", message: "Sun shadows" }),
        cost: msg({
          id: "settings.graphics.toggle.sunShadows.cost",
          message: "A shadow map pass for terrain, plants, buildings and animals. High GPU cost."
        })
      },
      trafficWear: {
        label: msg({ id: "settings.graphics.toggle.trafficWear", message: "Worn paths" }),
        cost: msg({
          id: "settings.graphics.toggle.trafficWear.cost",
          message: "Ground wears into paths where settlers and carts walk. Low CPU and memory cost."
        })
      },
      weatherParticles: {
        label: msg({ id: "settings.graphics.toggle.weatherParticles", message: "Rain and snow particles" }),
        cost: msg({
          id: "settings.graphics.toggle.weatherParticles.cost",
          message: "Falling rain and snow particles. Low to medium GPU cost."
        })
      }
    },
    togglesSummary: msg({ id: "settings.graphics.togglesSummary", message: "{on} of {total} on" }),
    togglesTitle: msg({ id: "settings.graphics.togglesTitle", message: "Visual features" }),
    tone: msg({ id: "settings.graphics.tone", message: "Tone" }),
    toneChoice: {
      auto: msg({ id: "settings.graphics.tone.auto", message: "Auto (vivid by day, filmic at night)" }),
      filmic: msg({ id: "settings.graphics.tone.filmic", message: "Filmic" }),
      vivid: msg({ id: "settings.graphics.tone.vivid", message: "Vivid" })
    },
    toneHint: msg({
      id: "settings.graphics.toneHint",
      message: "Colour response only, applied immediately. Auto turns filmic at dusk, at night and in rain."
    }),
    sunRays: msg({ id: "settings.graphics.sunRays", message: "Sun rays" }),
    sunRaysHint: msg({
      id: "settings.graphics.sunRays.hint",
      message: "Strength of the light shafts through tree crowns and between buildings in the first-person view, strongest at dawn and dusk. 0 % switches them off at no cost, 100 % is the standard look, up to 200 % for stronger shafts. Small GPU cost."
    }),
    sunRaysNeedsHigh: msg({
      id: "settings.graphics.sunRays.needsHigh",
      message: "Available on the High detail level only."
    }),
    sunRaysNeedsShadows: msg({
      id: "settings.graphics.sunRays.needsShadows",
      message: "Needs sun shadows."
    }),
    waterReflections: msg({ id: "settings.graphics.waterReflections", message: "Water reflections" }),
    waterReflectionsChoice: {
      off: msg({ id: "settings.graphics.waterReflections.off", message: "Off" }),
      on: msg({ id: "settings.graphics.waterReflections.on", message: "On" })
    },
    waterReflectionsCost: msg({
      id: "settings.graphics.waterReflections.cost",
      message: "Shores, buildings, ships and trees mirrored in calm water where they are on screen; elsewhere the water keeps reflecting the sky. Medium and High only; needs a colour buffer other than Off. Small GPU cost."
    })
  },
  sound: {
    enabled: msg({ id: "settings.sound.enabled", message: "Sound" }),
    environmentVolume: msg({ id: "settings.sound.environmentVolume", message: "Environment volume" }),
    layer: {
      rain: msg({ id: "settings.sound.layer.rain", message: "Rain / snow" }),
      trees: msg({ id: "settings.sound.layer.trees", message: "Leaves & wind" }),
      water: msg({ id: "settings.sound.layer.water", message: "Sea & rivers" }),
      wildlife: msg({ id: "settings.sound.layer.wildlife", message: "Wildlife" })
    },
    masterVolume: msg({ id: "settings.sound.masterVolume", message: "Master volume" }),
    musicVolume: msg({ id: "music.volume.label", message: "Music volume" }),
    title: msg({ id: "settings.sound.title", message: "Sounds" })
  },
  panelTitle: msg({ id: "settings.panel.title", message: "Settings" }),
  tabs: {
    graphics: msg({ id: "settings.tabs.graphics", message: "Graphics" }),
    label: msg({ id: "settings.tabs.label", message: "Settings categories" }),
    misc: msg({ id: "settings.tabs.misc", message: "Misc" }),
    sounds: msg({ id: "settings.sound.title", message: "Sounds" })
  },
  weather: {
    cycleSpeed: msg({ id: "settings.weather.cycleSpeed", message: "Day cycle speed" }),
    cycleSpeedTitle: msg({
      id: "settings.weather.cycleSpeedTitle",
      message: "Speeds up the running day and night for time-lapse recordings; picture only, not saved."
    }),
    dayCycle: msg({ id: "settings.weather.dayCycle", message: "Day cycle" }),
    locked: msg({ id: "settings.weather.locked", message: "This map controls time and weather." }),
    preset: {
      dawn: msg({ id: "settings.weather.preset.dawn", message: "Dawn" }),
      day: msg({ id: "settings.weather.preset.day", message: "Day" }),
      dusk: msg({ id: "settings.weather.preset.dusk", message: "Dusk" }),
      night: msg({ id: "settings.weather.preset.night", message: "Night" })
    },
    rain: msg({ id: "settings.weather.rain", message: "Rain" }),
    snow: msg({ id: "settings.weather.snow", message: "Snow" }),
    title: msg({ id: "settings.weather.title", message: "Time & weather" })
  },
  world: {
    critters: msg({ id: "settings.world.critters", message: "Critters" }),
    fog: msg({ id: "settings.world.fog", message: "Fog of war" }),
    fogLocked: msg({ id: "settings.world.fogLocked", message: "Fog of war is off in this game" }),
    fogTitle: msg({
      id: "settings.world.fogTitle",
      message: "Show or hide fog without changing exploration or saved island progress."
    }),
    title: msg({ id: "settings.world.title", message: "World" })
  }
} as const;
