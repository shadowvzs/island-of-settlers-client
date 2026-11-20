// oxlint-disable max-lines -- one feature-owned catalog keeps the quest form ids reviewable together.
import { msg } from "@lingui/core/macro";

/** Copy of the Quests tab: list, quest form and declared home rewards (design §13.6); hu and de in the PO. */
export const QUEST_MESSAGES = {
  tab: msg({ id: "mapEditor.script.tab.quests", message: "Quests" }),
  list: msg({ id: "mapEditor.script.quests.list", message: "Quests in order" }),
  add: msg({ id: "mapEditor.script.quests.add", message: "+ Quest" }),
  empty: msg({ id: "mapEditor.script.quests.empty", message: "No quest yet." }),
  none: msg({ id: "mapEditor.script.quests.none", message: "Choose a quest or add one." }),
  untitled: msg({ id: "mapEditor.script.quests.untitled", message: "(no title)" }),
  moveUp: msg({ id: "mapEditor.script.quests.moveUp", message: "Move {name} up" }),
  moveDown: msg({ id: "mapEditor.script.quests.moveDown", message: "Move {name} down" }),
  delete: msg({ id: "mapEditor.script.quests.delete", message: "Delete quest" }),
  deleteRefused: msg({
    id: "mapEditor.script.quests.deleteRefused",
    message: "{name} cannot be deleted while it is used by {users}."
  }),
  usedBy: msg({ id: "mapEditor.script.quests.usedBy", message: "Used by: {users}" }),
  unused: msg({ id: "mapEditor.script.quests.unused", message: "No trigger refers to it" }),
  silentBadge: msg({ id: "mapEditor.script.quests.silentBadge", message: "silent" }),
  title: msg({ id: "mapEditor.script.quests.title", message: "Title" }),
  text: msg({ id: "mapEditor.script.quests.text", message: "Description" }),
  visibility: msg({ id: "mapEditor.script.quests.visibility", message: "Player sees it" }),
  visible: msg({ id: "mapEditor.script.quests.visible", message: "visible (the player claims it)" }),
  hidden: msg({ id: "mapEditor.script.quests.hidden", message: "silent (claims itself on success)" }),
  hiddenNote: msg({
    id: "mapEditor.script.quests.hiddenNote",
    message: "A silent quest is never listed: on success it claims itself and runs its success actions; on failure it runs its failure actions."
  }),
  activation: msg({ id: "mapEditor.script.quests.activation", message: "Starts" }),
  activationAuto: msg({ id: "mapEditor.script.quests.activationAuto", message: "by its group and prerequisites" }),
  activationAction: msg({ id: "mapEditor.script.quests.activationAction", message: "only by a trigger" }),
  group: msg({ id: "mapEditor.script.quests.group", message: "Group" }),
  noGroup: msg({ id: "mapEditor.script.quests.noGroup", message: "no group" }),
  optional: msg({ id: "mapEditor.script.quests.optional", message: "Optional (may be skipped)" }),
  prerequisites: msg({ id: "mapEditor.script.quests.prerequisites", message: "Needs these quests finished first" }),
  completedWhen: msg({ id: "mapEditor.script.quests.completedWhen", message: "Completed when" }),
  objectives: {
    condition: msg({ id: "mapEditor.script.quests.objective.condition", message: "a condition is true" }),
    counterReached: msg({
      id: "mapEditor.script.quests.objective.counterReached",
      message: "a counter reaches a number (counts offline too)"
    }),
    scripted: msg({ id: "mapEditor.script.quests.objective.scripted", message: "a trigger completes it" }),
    builtIn: msg({ id: "mapEditor.script.quests.objective.builtIn", message: "built-in goal: {kind}" })
  },
  addCondition: msg({ id: "mapEditor.script.quests.addCondition", message: "+ condition" }),
  showProgress: msg({ id: "mapEditor.script.quests.showProgress", message: "Show progress to the player" }),
  progress: msg({ id: "mapEditor.script.quests.progress", message: "Progress" }),
  counter: msg({ id: "mapEditor.script.quests.counter", message: "Counter" }),
  counterHint: msg({
    id: "mapEditor.script.quests.counterHint",
    message: "ship, tools, produce:<ware> (produce:planks) or plant:<tree family> (plant:tree)"
  }),
  target: msg({ id: "mapEditor.script.quests.target", message: "Target" }),
  since: msg({ id: "mapEditor.script.quests.since", message: "Counting from" }),
  sinceActivation: msg({ id: "mapEditor.script.quests.sinceActivation", message: "quest start" }),
  sinceMapStart: msg({ id: "mapEditor.script.quests.sinceMapStart", message: "map start" }),
  scriptedNote: msg({
    id: "mapEditor.script.quests.scriptedNote",
    message: "A trigger's “complete quest” or “fail quest” action ends it."
  }),
  failure: msg({ id: "mapEditor.script.quests.failure", message: "Fails when" }),
  failureOn: msg({ id: "mapEditor.script.quests.failureOn", message: "It can fail" }),
  deadline: msg({ id: "mapEditor.script.quests.deadline", message: "Deadline" }),
  deadlines: {
    none: msg({ id: "mapEditor.script.quests.deadline.none", message: "none" }),
    playTime: msg({ id: "mapEditor.script.quests.deadline.playTime", message: "play time (paused offline)" }),
    gameTime: msg({ id: "mapEditor.script.quests.deadline.gameTime", message: "game time (runs offline)" }),
    date: msg({ id: "mapEditor.script.quests.deadline.date", message: "a date (UTC)" }),
    dateAfterActivation: msg({
      id: "mapEditor.script.quests.deadline.dateAfterActivation",
      message: "a time after the quest starts"
    })
  },
  seconds: msg({ id: "mapEditor.script.quests.seconds", message: "Seconds" }),
  days: msg({ id: "mapEditor.script.quests.days", message: "Days" }),
  hours: msg({ id: "mapEditor.script.quests.hours", message: "Hours" }),
  minutes: msg({ id: "mapEditor.script.quests.minutes", message: "Minutes" }),
  dateUtc: msg({ id: "mapEditor.script.quests.dateUtc", message: "Date and time (UTC)" }),
  repeat: msg({ id: "mapEditor.script.quests.repeat", message: "Repeat" }),
  repeats: {
    once: msg({ id: "mapEditor.script.quests.repeat.once", message: "once" }),
    onCompletion: msg({ id: "mapEditor.script.quests.repeat.onCompletion", message: "again after each claim" }),
    interval: msg({ id: "mapEditor.script.quests.repeat.interval", message: "every interval (fixed UTC grid)" }),
    calendar: msg({ id: "mapEditor.script.quests.repeat.calendar", message: "on calendar dates (UTC)" })
  },
  maxClaims: msg({ id: "mapEditor.script.quests.maxClaims", message: "Claims at most (empty = no limit)" }),
  month: msg({ id: "mapEditor.script.quests.month", message: "Month" }),
  day: msg({ id: "mapEditor.script.quests.day", message: "Day" }),
  weekday: msg({ id: "mapEditor.script.quests.weekday", message: "Weekday" }),
  anyValue: msg({ id: "mapEditor.script.quests.anyValue", message: "any" }),
  timeUtc: msg({ id: "mapEditor.script.quests.timeUtc", message: "Time (UTC)" }),
  retry: msg({ id: "mapEditor.script.quests.retry", message: "Retry after a failure" }),
  claimDates: msg({
    id: "mapEditor.script.quests.claimDates",
    message: "Next claim dates if it starts now (your time, UTC in brackets)"
  }),
  claimDate: msg({ id: "mapEditor.script.quests.claimDate", message: "{local} (UTC {utc})" }),
  claimHistory: msg({
    id: "mapEditor.script.quests.claimHistory",
    message: "Each claim is stored with its date; a repeating quest can be claimed again only in a later window."
  }),
  cost: msg({ id: "mapEditor.script.quests.cost", message: "Cost (taken from the stock at claim)" }),
  mapReward: msg({ id: "mapEditor.script.quests.mapReward", message: "Map reward" }),
  homeReward: msg({ id: "mapEditor.script.quests.homeReward", message: "Home reward" }),
  edit: msg({ id: "mapEditor.script.quests.edit", message: "Edit…" }),
  nothing: msg({ id: "mapEditor.script.quests.nothing", message: "nothing" }),
  replayNote: msg({
    id: "mapEditor.script.quests.replayNote",
    message: "Replaying a completed campaign map pays one third of the home reward (rounded) on every replay:"
  }),
  replayNothing: msg({
    id: "mapEditor.script.quests.replayNothing",
    message: "Replaying a completed campaign map pays none of this home reward."
  }),
  onActivate: msg({ id: "mapEditor.script.quests.onActivate", message: "When it starts" }),
  onSuccess: msg({ id: "mapEditor.script.quests.onSuccess", message: "When it is claimed (silent: on success)" }),
  onFailure: msg({ id: "mapEditor.script.quests.onFailure", message: "When it fails" }),
  groups: {
    title: msg({ id: "mapEditor.script.quests.groups.title", message: "Quest groups" }),
    add: msg({ id: "mapEditor.script.quests.groups.add", message: "+ Group" }),
    name: msg({ id: "mapEditor.script.quests.groups.name", message: "Group title" }),
    order: msg({ id: "mapEditor.script.quests.groups.order", message: "Quests in it" }),
    parallel: msg({ id: "mapEditor.script.quests.groups.parallel", message: "together" }),
    sequential: msg({ id: "mapEditor.script.quests.groups.sequential", message: "one after the other" }),
    level: msg({ id: "mapEditor.script.quests.groups.level", message: "From player level (empty = always)" }),
    requires: msg({ id: "mapEditor.script.quests.groups.requires", message: "After these groups" }),
    delete: msg({ id: "mapEditor.script.quests.groups.delete", message: "Delete group" }),
    deleteRefused: msg({
      id: "mapEditor.script.quests.groups.deleteRefused",
      message: "A group cannot be deleted while a quest or another group uses it."
    })
  },
  rewards: {
    title: msg({ id: "mapEditor.script.quests.rewards.title", message: "Home rewards triggers may grant" }),
    info: msg({
      id: "mapEditor.script.quests.rewards.info",
      message: "A trigger's “grant home reward” action pays only a reward declared here; the server checks it once per occurrence."
    }),
    add: msg({ id: "mapEditor.script.quests.rewards.add", message: "+ Home reward" }),
    modeNotes: {
      none: msg({
        id: "mapEditor.script.quests.rewards.modeNotes.none",
        message: "The game settings pay no rewards: these home rewards are kept but not paid."
      }),
      wallet: msg({
        id: "mapEditor.script.quests.rewards.modeNotes.wallet",
        message: "Without a home island only gems and XP are paid: the other lines are kept but not paid."
      })
    },
    name: msg({ id: "mapEditor.script.quests.rewards.name", message: "Name (editor only)" }),
    newName: msg({ id: "mapEditor.script.quests.rewards.newName", message: "Home reward {number}" }),
    occurrence: msg({ id: "mapEditor.script.quests.rewards.occurrence", message: "Paid" }),
    occurrences: {
      once: msg({ id: "mapEditor.script.quests.rewards.once", message: "once" }),
      window: msg({ id: "mapEditor.script.quests.rewards.window", message: "once per repeat window" }),
      counter: msg({ id: "mapEditor.script.quests.rewards.counter", message: "a number of times" })
    },
    maxOccurrences: msg({ id: "mapEditor.script.quests.rewards.maxOccurrences", message: "Times" }),
    lines: msg({ id: "mapEditor.script.quests.rewards.lines", message: "Rewards" }),
    delete: msg({ id: "mapEditor.script.quests.rewards.delete", message: "Delete home reward {name}" })
  }
};
