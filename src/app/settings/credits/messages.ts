import { msg } from "@lingui/core/macro";

/**
 * Credits window chrome. Asset titles, author names, source links, licence proper names and the
 * required attribution text stay English; these are the labels and group headings around them.
 */
export const CREDITS_MESSAGES = {
  byAuthor: msg({ id: "settings.credits.byAuthor", message: "by {author}" }),
  categories: {
    fonts: {
      title: msg({ id: "settings.credits.categories.fonts.title", message: "Fonts" })
    },
    libraries: {
      title: msg({ id: "settings.credits.categories.libraries.title", message: "Libraries in the game" })
    },
    models: {
      note: msg({
        id: "settings.credits.categories.models.note",
        message: "Third-party 3D models, adapted for the game."
      }),
      title: msg({ id: "settings.credits.categories.models.title", message: "3D models" })
    },
    original: {
      title: msg({
        id: "settings.credits.categories.original.title",
        message: "Models, textures and icons made for the game"
      })
    },
    sky: {
      title: msg({ id: "settings.credits.categories.sky.title", message: "Sky textures" })
    },
    sounds: {
      title: msg({ id: "settings.sound.title", message: "Sounds" })
    },
    terrain: {
      note: msg({
        id: "settings.credits.categories.terrain.note",
        message: "Only processed geometry derived from these ships."
      }),
      title: msg({ id: "settings.credits.categories.terrain.title", message: "Terrain and rocks" })
    },
    tools: {
      note: msg({
        id: "settings.credits.categories.tools.note",
        message: "Used to make the game; not shipped."
      }),
      title: msg({ id: "settings.credits.categories.tools.title", message: "Tools" })
    }
  },
  creator: msg({ id: "settings.credits.creator", message: "Creator" }),
  creatorRole: msg({
    id: "settings.credits.creatorRole",
    message: "Game design and development"
  }),
  licence: {
    nasaMedia: msg({ id: "settings.credits.licence.nasaMedia", message: "NASA media usage" }),
    owner: msg({ id: "settings.credits.licence.owner", message: "Owner-owned" }),
    system: msg({ id: "settings.credits.licence.system", message: "Device font" })
  },
  music: {
    credits: msg({ id: "settings.credits.music.credits", message: "Music credits" }),
    heading: msg({
      id: "settings.credits.music.heading",
      message: "Music and instrument licences"
    }),
    instrumentLicence: msg({
      id: "settings.credits.music.instrumentLicence",
      message: "Instrument licence"
    }),
    note: msg({
      id: "settings.credits.music.note",
      message: "Bundled music credits and the full instrument licence:"
    })
  },
  originalWork: msg({
    id: "settings.credits.originalWork",
    message: "original work for Island of Settlers"
  }),
  window: {
    loadFailed: msg({
      id: "settings.credits.window.loadFailed",
      message: "The credits could not load. Close and reopen to retry."
    }),
    loading: msg({ id: "settings.credits.window.loading", message: "Loading credits…" })
  }
} as const;
