import { msg } from "@lingui/core/macro";

/** Copy of the play-test debug log; trigger, quest and variable names are map data. */
export const TEST_PLAY_MESSAGES = {
  clear: msg({ id: "script.testPlay.clear", message: "Clear the log" }),
  collapse: msg({ id: "script.testPlay.collapse", message: "Collapse the script log" }),
  empty: msg({ id: "script.testPlay.empty", message: "Nothing has run yet." }),
  expand: msg({ id: "script.testPlay.expand", message: "Expand the script log" }),
  filter: {
    quest: msg({ id: "script.testPlay.filter.quest", message: "Quest state changes" }),
    run: msg({ id: "script.testPlay.filter.run", message: "Fired triggers" }),
    step: msg({ id: "script.testPlay.filter.step", message: "Run steps" }),
    variable: msg({ id: "script.testPlay.filter.variable", message: "Variable writes" })
  },
  line: {
    quest: msg({ id: "script.testPlay.line.quest", message: "Quest \"{quest}\": {from} → {to}" }),
    questList: msg({ id: "script.testPlay.line.questList", message: "#{run} quest \"{quest}\" runs {list}" }),
    step: msg({ id: "script.testPlay.line.step", message: "#{run} {step}" }),
    triggerFired: msg({
      id: "script.testPlay.line.triggerFired", message: "#{run} trigger \"{trigger}\" fired by {event}"
    }),
    triggerStarted: msg({ id: "script.testPlay.line.triggerStarted", message: "#{run} trigger \"{trigger}\" started" }),
    variable: msg({ id: "script.testPlay.line.variable", message: "{variable} = {value}" })
  },
  noScript: msg({ id: "script.testPlay.noScript", message: "This map runs no script." }),
  title: msg({ id: "script.testPlay.title", message: "Script log" })
};
