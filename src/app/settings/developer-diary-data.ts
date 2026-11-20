export interface DeveloperDiaryEntry {
  date: string;
  title: string;
  changes: readonly string[];
}

/** Newest first. Add player-facing updates here, using plain language rather than commit messages. */
export const DEVELOPER_DIARY: readonly DeveloperDiaryEntry[] = [
  {
    date: "2026-10-18",
    title: "Music, new materials and room to explore",
    changes: [
      "Music player, Credits and Game News are now easy to find in the Main selection menu.",
      "The draggable music player has collection filters, a filename playlist and playback controls. Loop a favourite track, repeat the playlist, or add your own local audio files.",
      "Colony discoveries can bring hardwood and marble, cedar and limestone, walnut and basalt, or mahogany and granite as your level grows.",
      "Your storehouse catalog and gem shop reveal new material groups at the matching level. Any rare materials you already own stay visible.",
      "Upgrade your sawmill to unlock more plank recipes, then choose which kind to produce. Changing recipes returns unused logs to storage while current work finishes.",
      "Paved roads now progress through stone, marble, limestone, basalt and granite, with a little more speed at each step."
    ]
  },
  {
    date: "2026-10-16",
    title: "A familiar face on every voyage",
    changes: [
      "The map editor has gentle raise, lower, smooth and uneven-ground brushes. Sandy shore makes a low beach, and Sea lets you carve ocean water separately from lakes.",
      "The doodad eraser now clears trees as well as plants and stones, including palms left on a shoreline.",
      "Your loading picture now matches your nation. Nubian and Viking voyagers join the Roman and Japanese artwork.",
      "Reset ground now makes a flat, dry meadow, even when you brush over the sea. Undo and redo remember the height too."
    ]
  },
  {
    date: "2026-10-15",
    title: "More room to settle, and a little help for your builders",
    changes: [
      "Equal-sized islands now grow to use the available map space. Choosing fewer islands leaves more land on each one, while keeping sea lanes open for ships.",
      "Bigger adventures in map making: you can now create maps up to 512×512 tiles.",
      "Choose how many islands you want, and whether they should be mostly similar in size. Each one keeps room for buildings, roads, a headquarters and a working harbour.",
      "Building upgrades are proper jobs now. Carriers bring hardwood planks and marble, then a builder comes over with a hammer. Your regular worker can keep producing while the upgrade is under way.",
      "Need a few rare materials? Hardwood logs, hardwood planks and marble are now in the gem shop.",
      "Your whole territory stays clear of fog. Lookouts can still reveal more land beyond your border.",
      "Workers and infantry now place their feet more naturally on sloping ground.",
      "The loading picture now fills the screen from the start, without the awkward jump.",
      "Colony life has more to offer: hardwood foresters, hardwood woodcutters and marble quarries supply the new materials. The hardwood sawmill back home turns those logs into planks."
    ]
  }
];
