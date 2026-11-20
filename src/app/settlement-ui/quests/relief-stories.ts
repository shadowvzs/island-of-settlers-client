import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import drought from "../../../../assets/quest-disasters/drought.png";
import earthquake from "../../../../assets/quest-disasters/earthquake.png";
import flood from "../../../../assets/quest-disasters/flood.png";
import hurricane from "../../../../assets/quest-disasters/hurricane.png";
import volcano from "../../../../assets/quest-disasters/volcano.png";
import wildfire from "../../../../assets/quest-disasters/wildfire.png";
import { translateMessage } from "../../../shared/i18n/translate";
import type { DailyQuest } from "../../../shared/progression/daily-quests";

const STORIES = [
  { image: earthquake,
    title: msg({ id: "quest.relief.earthquake.1.title", message: "Help {village} after the earthquake" }),
    text: msg({ id: "quest.relief.earthquake.1.story", message: "An earthquake has shattered homes and damaged the well in {village}. Neighbours are sheltering together while builders clear the rubble. Their relief ship is collecting supplies to begin repairs." }) },
  { image: earthquake,
    title: msg({ id: "quest.relief.earthquake.2.title", message: "A safe home for {village}" }),
    text: msg({ id: "quest.relief.earthquake.2.story", message: "Aftershocks have left {village} unsafe. Families are gathered in the square while villagers shore up cracked walls. Send supplies with their relief ship so they can rebuild." }) },
  { image: volcano,
    title: msg({ id: "quest.relief.volcano.1.title", message: "Ash over {village}" }),
    text: msg({ id: "quest.relief.volcano.1.story", message: "A nearby volcano has covered {village} in ash. Lava destroyed outlying homes and fields, and the survivors are rebuilding away from the flow. Their relief ship needs supplies." }) },
  { image: volcano,
    title: msg({ id: "quest.relief.volcano.2.title", message: "Shelter after the eruption" }),
    text: msg({ id: "quest.relief.volcano.2.story", message: "The people of {village} escaped an eruption, but their workshops and stores were lost. A relief ship is gathering supplies for the displaced families and their new settlement." }) },
  { image: flood,
    title: msg({ id: "quest.relief.flood.1.title", message: "Flood relief for {village}" }),
    text: msg({ id: "quest.relief.flood.1.story", message: "Floodwater has filled the lanes of {village}, ruined stores and broken its footbridge. The villagers have reached higher ground. Their relief ship is collecting supplies for the recovery." }) },
  { image: flood,
    title: msg({ id: "quest.relief.flood.2.title", message: "Help the families above the flood" }),
    text: msg({ id: "quest.relief.flood.2.story", message: "Days of rain have flooded the homes and fields of {village}. Families are sharing the few dry cottages that remain. Send supplies on their relief ship to help them return home." }) },
  { image: hurricane,
    title: msg({ id: "quest.relief.hurricane.1.title", message: "Rebuild {village} after the storm" }),
    text: msg({ id: "quest.relief.hurricane.1.story", message: "A hurricane tore roofs from the houses of {village} and wrecked its fishing huts. The villagers are helping one another repair the damage. Their relief ship is asking for supplies." }) },
  { image: hurricane,
    title: msg({ id: "quest.relief.hurricane.2.title", message: "A harbour after the hurricane" }),
    text: msg({ id: "quest.relief.hurricane.2.story", message: "Storm waves battered {village}, breaking fences and damaging the waterfront. Its people need supplies before the next bad weather arrives. A relief ship is collecting aid for them." }) },
  { image: wildfire,
    title: msg({ id: "quest.relief.wildfire.1.title", message: "Help {village} recover from fire" }),
    text: msg({ id: "quest.relief.wildfire.1.story", message: "A wildfire reached {village} and burned several timber homes. The villagers saved their neighbours, but lost much of their stock. Their relief ship needs supplies for rebuilding." }) },
  { image: wildfire,
    title: msg({ id: "quest.relief.wildfire.2.title", message: "New beginnings for {village}" }),
    text: msg({ id: "quest.relief.wildfire.2.story", message: "The fire around {village} has finally faded. Families are clearing charred beams and sharing the surviving houses. Send supplies with their relief ship to help restore the village." }) },
  { image: drought,
    title: msg({ id: "quest.relief.drought.1.title", message: "Drought relief for {village}" }),
    text: msg({ id: "quest.relief.drought.1.story", message: "The well in {village} has run dry and its fields have withered. The villagers need supplies to repair waterworks and carry on until the rains return. Their relief ship is collecting aid." }) },
  { image: drought,
    title: msg({ id: "quest.relief.drought.2.title", message: "Help {village} through the dry season" }),
    text: msg({ id: "quest.relief.drought.2.story", message: "A long drought has left {village} short of supplies. Farmers are tending the last surviving crops while neighbours deepen the well. Their relief ship is asking for help." }) }
] as const;

const VILLAGES = ["Willowhaven", "Stonebrook", "Ashford", "Seabrook", "Greenhollow", "Reedbank"];
const storyHash = (text: string) => {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
};

/** A saved quest keeps its illustration/story without another serialized random roll. */
export const reliefStory = (quest: DailyQuest, i18n?: I18n) => {
  const hash = storyHash(`${quest.id}:${quest.ware}:${quest.amount}`);
  const story = STORIES[hash % STORIES.length]!;
  const village = VILLAGES[Math.floor(hash / STORIES.length) % VILLAGES.length]!;
  return { image: story.image, text: translateMessage(i18n, story.text, { village }),
    title: translateMessage(i18n, story.title, { village }) };
};
