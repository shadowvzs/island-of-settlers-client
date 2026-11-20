import { msg } from "@lingui/core/macro";

/** Settings > Graphics > Adaptive performance copy (R09/C13 budget controller). */
export const ADAPTIVE_PERFORMANCE_MESSAGES = {
  auto: msg({ id: "settings.adaptive.auto", message: "Auto: hold the frame rate" }),
  autoTitle: msg({
    id: "settings.adaptive.autoTitle",
    message: "Below 40 fps the game lowers the 3D resolution when the graphics card is the limit, or animates small distant characters less often and hides decorative birds and butterflies when the processor is the limit. Gameplay, units and the fog of war never change."
  }),
  exhausted: msg({
    id: "settings.adaptive.exhausted",
    message: "Still below 40 fps with every allowed saving: a lower Detail level would help."
  }),
  frameRateLimit: msg({ id: "settings.adaptive.frameRateLimit", message: "Frame rate limit" }),
  frameRateLimitChoice: {
    display: msg({ id: "settings.adaptive.frameRateLimit.display", message: "Display rate (no limit)" }),
    limit60: msg({ id: "settings.adaptive.frameRateLimit.limit60", message: "60 fps" }),
    saver: msg({ id: "settings.adaptive.frameRateLimit.saver", message: "Battery saver (30 or 40 fps)" })
  },
  frameRateLimitTitle: msg({
    id: "settings.adaptive.frameRateLimitTitle",
    message: "Draws every second or third display frame to save power and heat; frames stay evenly paced."
  }),
  lowestScale: msg({ id: "settings.adaptive.lowestScale", message: "Lowest resolution" }),
  lowestScaleChoice: {
    detail: msg({ id: "settings.adaptive.lowestScale.detail", message: "Detail default ({percent} %)" }),
    percent: msg({ id: "mapEditor.brush.strengthLevel", message: "{percent} %" })
  },
  statusOff: msg({ id: "settings.adaptive.statusOff", message: "Now: off, everything at full detail." }),
  statusFull: msg({ id: "settings.adaptive.statusFull", message: "Now: full resolution and detail." }),
  statusReduced: msg({
    id: "settings.adaptive.statusReduced",
    message: "Now: resolution {percent} %, processor savings {level} of {levels}."
  }),
  title: msg({ id: "settings.adaptive.title", message: "Adaptive performance" })
};
