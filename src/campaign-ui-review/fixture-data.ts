import type { CampaignRewards } from "../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignSpeaker } from "../../../island-of-settlers-shared/src/campaign/cinematics/types";
import type { ScriptActor } from "../../../island-of-settlers-shared/src/script/types/actors";
import romanPortrait from "../../assets/commander-portraits/roman.png?url";
import vikingPortrait from "../../assets/commander-portraits/viking.png?url";
import voyageImage from "../app/assets/island-voyage-1.webp";
import { actorPortraitId, scriptActorSpeakers } from "../app/campaign/cinematics/actor-speakers";
import type { SpeakLine } from "../app/campaign/cinematics/ui/helpers";
import type { StoryClaim, StoryPage, StoryPanelContent } from "../app/campaign/story-panel/types";

/**
 * Review fixtures of the campaign story panel (C11a) and the speaker panel (CIN5). Portrait stand-ins are the
 * commander portraits until the owner's advisor artwork exists; ids without an image show the fallbacks.
 */
const spawnActor = (id: string, look: "bandits" | "pirates", fields: Partial<ScriptActor> = {}) => ({
  binding: "spawn", count: 1, id, lifetime: "keepIncarnation", look: { kind: look }, name: id,
  owner: { faction: 1, kind: "slot" }, place: { region: { id: "region-1", k: "ref", kind: "region" } },
  respawn: "refuse", spawnAtStart: true, type: { type: { id: "soldier:heavy", k: "ref", kind: "content" } }, ...fields
}) as ScriptActor;

/**
 * Script actors that speak under their display name: a pirate the map maker named (with a commander stand-in until
 * the pirate portrait exists) and an unnamed bandit (the look's default name, initials medallion).
 */
const FIXTURE_ACTORS: ScriptActor[] = [
  spawnActor("actor-1", "pirates", { displayName: { en: "Redbeard the Elder", hu: "Az idősebb Vörösszakáll" } }),
  spawnActor("actor-2", "bandits")
];

const IMAGES: Readonly<Record<string, string>> = {
  [actorPortraitId(FIXTURE_ACTORS[0]!)]: vikingPortrait,
  "portrait-advisor-neutral": romanPortrait,
  "portrait-captain-neutral": vikingPortrait,
  "story-landing": voyageImage
};

export const resolveFixtureImage = (imageId: string) => IMAGES[imageId] ?? null;

const INTRO_PAGES: StoryPage[] = [
  {
    imageId: "story-landing",
    text: {
      en: "Our ships have reached the Western Reach at last. The old harbour lies in ruins and the forests are " +
        "thick with mist.\nBuild a foothold before the winter storms arrive, and keep an eye on the ridge: smoke " +
        "has been seen there at dusk.",
      hu: "Hajóink végre elérték a Nyugati Partot. A régi kikötő romokban hever, az erdőket sűrű köd borítja.\n" +
        "Vess meg a lábad, mielőtt a téli viharok megérkeznek, és tartsd szemmel a hegygerincet: alkonyatkor " +
        "füstöt láttak ott."
    },
    title: { en: "The Western Reach", hu: "A Nyugati Part" }
  },
  {
    imageId: "story-missing-image",
    text: {
      en: "Aurelia unrolls a weathered chart across the crates. \"The pirates came from the north, and they will " +
        "come again. A palisade will not stop them, but a watchtower on the ridge will see them first.\"\n" +
        "\"Gather timber and stone, train a few soldiers, and do not let the harbour fall. Everything we brought " +
        "from home is stored there.\"\nShe taps the chart twice, where a small cove hides behind the cliffs. " +
        "\"And if you find the old lighthouse keeper, bring him to me. He knows these waters better than anyone.\"",
      hu: "Aurelia egy viharvert térképet terít ki a ládákon. „A kalózok északról jöttek, és vissza is fognak " +
        "térni. Egy cölöpkerítés nem állítja meg őket, de egy őrtorony a gerincen előbb meglátja őket.”\n" +
        "„Gyűjts fát és követ, képezz ki néhány katonát, és ne hagyd elesni a kikötőt. Mindent, amit otthonról " +
        "hoztunk, ott tárolunk.”\nKétszer megkocogtatja a térképet ott, ahol egy kis öböl bújik meg a sziklák " +
        "mögött. „És ha megtalálod az öreg világítótorony-őrt, hozd el hozzám. Ő mindenkinél jobban ismeri ezeket " +
        "a vizeket.”"
    },
    title: { en: "Aurelia's Counsel", hu: "Aurelia tanácsa" }
  }
];

const EPILOGUE_PAGE: StoryPage = {
  imageId: "story-landing",
  text: {
    en: "The last pirate ship burns beyond the reef, and the Western Reach is quiet at last. The settlers raise a " +
      "lantern on the harbour wall; the fleet can sail home with full holds.",
    hu: "Az utolsó kalózhajó a zátonyon túl ég, és a Nyugati Part végre elcsendesedik. A telepesek lámpást " +
      "emelnek a kikötő falára; a flotta megrakott rakterekkel indulhat haza."
  },
  title: { en: "The Reach Is Ours", hu: "A Part a miénk" }
};

const GRANTED_REWARDS: CampaignRewards = {
  coins: 250,
  decorations: [{ amount: 2, item: "roadDecoration:roman-rusticated-arch:limestone" }],
  gems: 5,
  goods: [{ amount: 40, ware: "planks" }, { amount: 12, ware: "sword" }, { amount: 30, ware: "bread" }],
  xp: 400
};

export const introContent = (replay: boolean): StoryPanelContent =>
  ({ kind: "intro", pages: INTRO_PAGES, replay });

export const epilogueContent = (claim: StoryClaim): StoryPanelContent =>
  ({ claim, kind: "epilogue", outcome: "victory", pages: [EPILOGUE_PAGE], replay: false });

export const GRANTED_CLAIM: StoryClaim = { rewards: GRANTED_REWARDS, status: "granted" };

/** A large epilogue reward: every home reward kind and more decorations than fit (grouped, "+N more"). */
const RICH_REWARDS: CampaignRewards = {
  coins: 1200,
  decorations: [
    { amount: 2, item: "roadDecoration:roman-rusticated-arch:limestone" },
    { amount: 1, item: "roadDecoration:japanese-stone-lantern:granite" },
    { amount: 3, item: "roadDecoration:plant-red-maple-standalone-ground-2:native" },
    { amount: 1, item: "roadDecoration:plant-bonsai-azalea-roadside-pot-2:native" },
    { amount: 1, item: "roadDecoration:roman-rusticated-arch:limestone" },
    { amount: 2, item: "roadDecoration:plant-red-rose-roadside-pot-2:native" },
    { amount: 1, item: "roadDecoration:persian-pointed-portal:limestone" }
  ],
  gems: 25,
  goods: [{ amount: 40, ware: "planks" }, { amount: 12, ware: "sword" }],
  xp: 1500
};

export const RICH_CLAIM: StoryClaim = { rewards: RICH_REWARDS, status: "granted" };

const FIXTURE_SPEAKERS: CampaignSpeaker[] = [
  {
    id: "advisor",
    name: { en: "Aurelia Varro", hu: "Aurelia Varro" },
    portraits: { neutral: "portrait-advisor-neutral", worried: "portrait-advisor-worried" },
    side: "left"
  },
  {
    id: "captain",
    name: { en: "Captain Brannoc", hu: "Brannoc kapitány" },
    portraits: { neutral: "portrait-captain-neutral" },
    side: "right"
  },
  { id: "keeper", name: { en: "Old Tamsin", hu: "Az öreg Tamsin" }, portraits: { neutral: "portrait-keeper" } }
];

/** The campaign speakers plus the script's named actors, as the game's cinematic context joins them. */
export const FIXTURE_ACTOR_SPEAKERS: CampaignSpeaker[] =
  [...FIXTURE_SPEAKERS, ...scriptActorSpeakers({ actors: FIXTURE_ACTORS })];

const speakLine = (id: string, speakerId: string, text: SpeakLine["text"], extra: Partial<SpeakLine> = {}) =>
  ({ delayMs: 0, id, kind: "speak", speakerId, start: "afterPrevious", text, timing: "auto", ...extra }) as SpeakLine;

export const FIXTURE_LINES: SpeakLine[] = [
  speakLine("line-1", "advisor", {
    en: "Sails on the horizon. Whoever they are, they did not send word ahead.",
    hu: "Vitorlák a láthatáron. Akárkik is ők, nem küldtek előre hírt."
  }),
  speakLine("line-2", "captain", {
    en: "Easy, governor. We are traders from the north, and we come in peace.",
    hu: "Csak nyugodtan, kormányzó. Északi kereskedők vagyunk, és békével jövünk."
  }),
  speakLine("line-3", "advisor", {
    en: "Peaceful traders do not hide forty armed men below deck. We will let them land, but our soldiers stay at " +
      "the harbour until we know what they really want. Send a runner to the watchtower and light the signal fire " +
      "if a second ship appears.",
    hu: "A békés kereskedők nem rejtenek negyven fegyverest a fedélzet alatt. Hagyjuk őket kikötni, de a " +
      "katonáink a kikötőben maradnak, amíg meg nem tudjuk, mit akarnak valójában. Küldj futárt az őrtoronyhoz, " +
      "és gyújtsátok meg a jelzőtüzet, ha egy második hajó is feltűnik."
  }, { expression: "worried" }),
  speakLine("line-4", "keeper", {
    en: "The lighthouse saw them first. It always does.",
    hu: "A világítótorony látta meg őket először. Mindig így van."
  })
];

export const FIXTURE_ACTOR_LINES: SpeakLine[] = [
  speakLine("actor-line-1", "actor-1", {
    en: "Strike your colours, governor. This harbour pays its toll to me now.",
    hu: "Vonja be a zászlót, kormányzó. Ez a kikötő mostantól nekem fizet vámot."
  }),
  speakLine("actor-line-2", "actor-2", {
    en: "And the road through the hills is ours.",
    hu: "A dombokon átvezető út pedig a miénk."
  })
];
