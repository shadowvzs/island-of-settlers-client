import { msg } from "@lingui/core/macro";

/** All exploration HUD/input copy, ready for the coordinator's single Lingui extraction. */
export const EXPLORATION_MESSAGES = {
  entry: {
    activeLabel: msg({
      id: "exploration.entry.activeLabel",
      message: "Exploration active"
    }),
    activeTitle: msg({
      id: "exploration.entry.activeTitle",
      message: "Use Leave to return to the island view"
    }),
    blockedLabel: msg({
      id: "exploration.entry.blockedLabel",
      message: "Exploration unavailable"
    }),
    blockedTitle: msg({
      id: "exploration.entry.blockedTitle",
      message: "Finish the current map action before exploring."
    }),
    cooldownBadge: msg({
      id: "exploration.entry.cooldownBadge",
      message: "{seconds}s"
    }),
    cooldownLabel: msg({
      id: "exploration.entry.cooldownLabel",
      message: "Explore again in {seconds} seconds"
    }),
    label: msg({
      id: "exploration.entry.label",
      message: "Explore home island"
    }),
    preparingLabel: msg({
      id: "exploration.entry.preparingLabel",
      message: "Preparing explorer"
    }),
    preparingTitle: msg({
      id: "exploration.entry.preparingTitle",
      message: "Finding a safe place to start. Nothing has changed yet."
    }),
    title: msg({
      id: "exploration.entry.title",
      message: "Walk the home island as your portrait explorer"
    })
  },
  overlay: {
    entering: msg({
      id: "exploration.overlay.entering",
      message: "Entering the home island…"
    }),
    fullscreen: msg({
      id: "exploration.overlay.fullscreen",
      message: "Fullscreen"
    }),
    label: msg({
      id: "exploration.overlay.label",
      message: "Exploration controls"
    }),
    leave: msg({
      id: "exploration.overlay.leave",
      message: "Leave"
    }),
    leaveIn: msg({
      id: "exploration.overlay.leaveIn",
      message: "Leave unlocks in {seconds} seconds"
    }),
    look: msg({
      id: "exploration.overlay.look",
      message: "Look around"
    }),
    lookJoystick: msg({
      id: "exploration.overlay.lookJoystick",
      message: "Look stick"
    }),
    lookJoystickTitle: msg({
      id: "exploration.overlay.lookJoystickTitle",
      message: "Drag the look stick to turn and look up or down"
    }),
    lookTitle: msg({
      id: "exploration.overlay.lookTitle",
      message: "Drag to look around; click for mouse look"
    }),
    move: msg({
      id: "exploration.overlay.move",
      message: "Move"
    }),
    moveTitle: msg({
      id: "exploration.overlay.moveTitle",
      message: "Drag the joystick to walk"
    }),
    preparing: msg({
      id: "exploration.overlay.preparing",
      message: "Preparing the explorer…"
    }),
    progress: msg({
      id: "exploration.overlay.progress",
      message: "Exploration progress"
    }),
    progressValue: msg({
      id: "exploration.overlay.progressValue",
      message: "{percent}%"
    }),
    returning: msg({
      id: "exploration.overlay.returning",
      message: "Returning to the island view…"
    }),
    spyglass: msg({
      id: "exploration.overlay.spyglass",
      message: "Spyglass"
    }),
    spyglassDisabled: msg({
      id: "exploration.overlay.spyglassDisabled",
      message: "The spyglass is available once the explorer arrives."
    }),
    spyglassOff: msg({
      id: "exploration.overlay.spyglassOff",
      message: "Look through the spyglass"
    }),
    spyglassOn: msg({
      id: "exploration.overlay.spyglassOn",
      message: "Put the spyglass away"
    }),
    spyglassZoom: msg({
      id: "exploration.overlay.spyglassZoom",
      message: "Spyglass zoom"
    }),
    spyglassZoomIn: msg({
      id: "exploration.overlay.spyglassZoomIn",
      message: "Zoom spyglass in"
    }),
    spyglassZoomOut: msg({
      id: "exploration.overlay.spyglassZoomOut",
      message: "Zoom spyglass out"
    }),
    spyglassZoomValue: msg({
      id: "exploration.overlay.spyglassZoomValue",
      message: "{zoom}×"
    }),
    status: msg({
      id: "exploration.overlay.status",
      message: "Exploration status"
    }),
    dissipating: msg({
      id: "exploration.overlay.dissipating",
      message: "The explorer is leaving…"
    })
  },
  refusal: {
    generic: msg({
      id: "exploration.refusal.generic",
      message: "The explorer could not start. Nothing was changed."
    }),
    noSafeSpawn: msg({
      id: "exploration.refusal.noSafeSpawn",
      message: "No safe place to start exploring was found. Nothing was changed."
    })
  }
} as const;
