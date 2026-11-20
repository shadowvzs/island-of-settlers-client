import { msg } from "@lingui/core/macro";

/** Copy of the Variables tab (design §13.4); en source, hu and de in the PO catalogs. */
export const VARIABLE_MESSAGES = {
  tab: msg({ id: "mapEditor.script.tab.variables", message: "Variables" }),
  info: msg({
    id: "mapEditor.script.variables.info",
    message: "Map variables keep numbers, switches, texts and lists while the map runs. Triggers and quests read and change them; boards show them."
  }),
  add: msg({ id: "mapEditor.script.variables.add", message: "+ Variable" }),
  addType: msg({ id: "mapEditor.script.variables.addType", message: "Type of the new variable" }),
  search: msg({ id: "mapEditor.script.variables.search", message: "Search variables" }),
  empty: msg({ id: "mapEditor.script.variables.empty", message: "No variable yet." }),
  name: msg({ id: "mapEditor.script.variables.name", message: "Name" }),
  type: msg({ id: "mapEditor.script.variables.type", message: "Type" }),
  initial: msg({ id: "mapEditor.script.variables.initial", message: "Starts with" }),
  comment: msg({ id: "mapEditor.script.variables.comment", message: "Comment" }),
  questVisible: msg({ id: "mapEditor.script.variables.questVisible", message: "Usable in quest texts" }),
  yes: msg({ id: "mapEditor.script.variables.yes", message: "yes (on)" }),
  delete: msg({ id: "mapEditor.script.variables.delete", message: "Delete variable {name}" }),
  usedBy: msg({ id: "mapEditor.script.variables.usedBy", message: "Used by: {users}" }),
  unused: msg({ id: "mapEditor.script.variables.unused", message: "Not used yet" }),
  deleteRefused: msg({
    id: "mapEditor.script.variables.deleteRefused",
    message: "{name} cannot be deleted while it is used by {users}."
  }),
  retypeRefused: msg({
    id: "mapEditor.script.variables.retypeRefused",
    message: "The type of {name} cannot change while it is used by {users}."
  }),
  addItem: msg({ id: "mapEditor.script.variables.addItem", message: "+ item" }),
  item: msg({ id: "mapEditor.script.variables.item", message: "Item {number}" }),
  removeItem: msg({ id: "mapEditor.script.variables.removeItem", message: "Remove item {number}" }),
  maxLength: msg({ id: "mapEditor.script.variables.maxLength", message: "At most" }),
  runtime: msg({
    id: "mapEditor.script.variables.runtime",
    message: "Empty at start; actions store actors in it while the map runs."
  }),
  noRegion: msg({ id: "mapEditor.script.variables.noRegion", message: "no region" }),
  timerSeconds: msg({ id: "mapEditor.script.variables.timerSeconds", message: "Seconds" }),
  timerAutoStart: msg({ id: "mapEditor.script.variables.timerAutoStart", message: "Starts with the map" }),
  timerPeriodic: msg({ id: "mapEditor.script.variables.timerPeriodic", message: "Repeats" }),
  timerWindow: msg({ id: "mapEditor.script.variables.timerWindow", message: "Show a countdown window" }),
  timerTitle: msg({ id: "mapEditor.script.variables.timerTitle", message: "Countdown title" }),
  boardNote: msg({
    id: "mapEditor.script.variables.boardNote",
    message: "A board: its table is edited on the Multiboards tab."
  }),
  types: {
    boolean: msg({ id: "mapEditor.script.variables.types.boolean", message: "switch (yes/no)" }),
    number: msg({ id: "mapEditor.script.variables.types.number", message: "number" }),
    string: msg({ id: "mapEditor.script.variables.types.string", message: "word (editor text)" }),
    text: msg({ id: "mapEditor.script.variables.types.text", message: "player text (all languages)" }),
    "number[]": msg({ id: "mapEditor.script.variables.types.numberList", message: "number list" }),
    "string[]": msg({ id: "mapEditor.script.variables.types.stringList", message: "word list" }),
    actor: msg({ id: "mapEditor.script.variables.types.actor", message: "one actor" }),
    actorGroup: msg({ id: "mapEditor.script.variables.types.actorGroup", message: "actor group" }),
    region: msg({ id: "mapEditor.script.variables.types.region", message: "region" }),
    timer: msg({ id: "mapEditor.script.variables.types.timer", message: "timer" }),
    multiboard: msg({ id: "mapEditor.script.variables.types.multiboard", message: "board" })
  }
};
