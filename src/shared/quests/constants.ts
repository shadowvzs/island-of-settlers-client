/** Group id prefix of the tutorial chapters in the default home quest book (`chapter-<level>`). */
export const TUTORIAL_CHAPTER_GROUP_PREFIX = "chapter-";
/** The reward key of coins in a daily quest reward; every other key is a ware paid as goods. */
export const COINS_WARE = "coins";
/** Quest id prefix of a materialized quest of the global daily pool (`daily:<day>-<index>`). */
export const DAILY_QUEST_ID_PREFIX = "daily:";
/**
 * The shipped texts of a materialized daily quest: the quest window's existing Lingui ids with their English
 * source (`settlement.quests.*`; kept equal by tests/quest-daily-book-parity.test.ts).
 */
export const DAILY_QUEST_TEXTS = Object.freeze({
  deliver: Object.freeze({
    goal: Object.freeze({
      en: "Bring the wares to your storage, then deliver them from here. They are taken from storage.",
      translationKey: "settlement.quests.goalDeliver"
    }),
    title: Object.freeze({ en: "Deliver {wares}", translationKey: "settlement.quests.deliver" })
  }),
  produce: Object.freeze({
    goal: Object.freeze({
      en: "Produce the wares in your own buildings today, then claim the reward.",
      translationKey: "settlement.quests.goalProduce"
    }),
    title: Object.freeze({ en: "Produce {wares}", translationKey: "settlement.quests.produce" })
  })
});
