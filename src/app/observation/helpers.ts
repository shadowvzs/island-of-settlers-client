import type { UnitDecisionReasonCode } from "../../shared/settlement/unit-decision-diagnostics";
import type { ObservationRoute, ObservationSubject } from "../camera-follow";

export type ObservationPickKind = "worker" | "ship";

/** Everything the Observe window shows; published only when a field changes. */
export interface ObservationView {
  detail: string;
  followDisabled: boolean;
  /** Read-only "why is it idle?" code of the inspected actor; absent for ships. */
  reason?: UnitDecisionReasonCode;
  routePressed: boolean;
  routeVisible: boolean;
  stopDisabled: boolean;
  title: string;
}

export interface ObservationViewInput {
  following: boolean;
  picking: ObservationPickKind | null;
  routeEnabled: boolean;
  subject: ObservationSubject | null;
}

export const OBSERVATION_HEADING = "Observe";

/** A Watch launcher of the camera panel: caption, HUD icon, accessible name and the pick it starts. */
export interface ObservationLauncher {
  caption: string;
  icon: string;
  kind: ObservationPickKind;
  label: string;
  onClick: () => void;
}

/** Watch worker / Watch ship: each starts picking its kind of subject. */
export const getObservationLaunchers = (
  onWatch: (kind: ObservationPickKind) => void
): readonly ObservationLauncher[] => [
  { caption: "Watch worker", icon: "people", kind: "worker", label: "Inspect a worker without issuing an order",
    onClick: () => onWatch("worker") },
  { caption: "Watch ship", icon: "ship", kind: "ship", label: "Inspect a visible ship", onClick: () => onWatch("ship") }
];
const UNAVAILABLE = "This subject is no longer available. Choose another worker or ship.";

const hasUpcomingRoute = (route: ObservationRoute | null | undefined) =>
  Boolean(route && route.points.length > route.index);

const getRouteNote = (subject: ObservationSubject) => hasUpcomingRoute(subject.route?.())
  ? " · Upcoming route (up to 64 waypoints)"
  : " · No active route";

const getDetail = ({ following, picking, routeEnabled, subject }: ObservationViewInput) => {
  if (picking) return `Select a visible ${picking} on the island. Close or Escape cancels.`;
  if (!subject) return UNAVAILABLE;
  const followNote = following ? " · Following" : "";
  const routeNote = routeEnabled ? getRouteNote(subject) : "";
  return `${subject.detail}${followNote}${routeNote}`;
};

/** The Observe window's texts and button states for the current subject, picking mode and route toggle. */
export const getObservationView = (input: ObservationViewInput): ObservationView => {
  const reason = input.subject?.reason?.();
  return {
    detail: getDetail(input),
    followDisabled: !input.subject || input.following,
    routePressed: input.routeEnabled,
    routeVisible: Boolean(input.subject?.route),
    stopDisabled: !input.following,
    title: input.subject?.label ?? OBSERVATION_HEADING,
    ...(reason === undefined ? {} : { reason })
  };
};

/** Keys that move or turn the camera and therefore stop following (Escape included). */
const CAMERA_KEYS = new Set(["escape", "arrowup", "arrowdown", "arrowleft", "arrowright",
  "w", "a", "s", "d", "q", "e", "c"]);

export const isCameraKey = (key: string) => CAMERA_KEYS.has(key.toLowerCase());

/** Keys typed into a text field or an IME composition belong to that field. */
export const isTypingKey = (event: Pick<KeyboardEvent, "isComposing" | "target">) => {
  if (event.isComposing) return true;
  const { target } = event;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName);
};

/** A picking press counts as a tap when the pointer moved at most this many pixels. */
const TAP_DISTANCE = 8;

export const isTap = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  Math.hypot(to.x - from.x, to.y - from.y) <= TAP_DISTANCE;
