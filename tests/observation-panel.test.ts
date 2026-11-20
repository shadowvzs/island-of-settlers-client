import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { ObservationSubject } from "../src/app/camera-follow";
import { createExternalStore } from "../src/app/components/ui-store";
import { getObservationView, isCameraKey, isTap } from "../src/app/observation/helpers";
import { ObservationContent } from "../src/app/observation/observation-content";
import { renderWithI18n } from "./helpers/render-with-i18n";

const noop = () => undefined;
const subject = (fields: Partial<ObservationSubject> = {}): ObservationSubject =>
  ({ detail: "Carrying logs", identity: {}, label: "Carrier", x: 1, y: 0, z: 1, ...fields });
const route = (points: number, index: number) => () => ({
  index, points: Array.from({ length: points }, (_, x) => ({ x, z: 0 }))
});

describe("observation view", () => {
  it("asks for a pick, then shows the subject with its follow state", () => {
    expect(getObservationView({ following: false, picking: "ship", routeEnabled: false, subject: null }))
      .toEqual({
        detail: "Select a visible ship on the island. Close or Escape cancels.", followDisabled: true,
        routePressed: false, routeVisible: false, stopDisabled: true, title: "Observe"
      });
    expect(getObservationView({ following: true, picking: null, routeEnabled: false, subject: subject() }))
      .toMatchObject({ detail: "Carrying logs · Following", followDisabled: true, stopDisabled: false,
        title: "Carrier" });
    expect(getObservationView({ following: false, picking: null, routeEnabled: false, subject: null }).detail)
      .toBe("This subject is no longer available. Choose another worker or ship.");
  });

  it("notes the upcoming route only while the route toggle is on", () => {
    const walking = subject({ route: route(4, 1) });
    expect(getObservationView({ following: false, picking: null, routeEnabled: true, subject: walking }))
      .toMatchObject({ detail: "Carrying logs · Upcoming route (up to 64 waypoints)", routePressed: true,
        routeVisible: true });
    const arrived = subject({ route: route(2, 2) });
    expect(getObservationView({ following: false, picking: null, routeEnabled: true, subject: arrived }).detail)
      .toBe("Carrying logs · No active route");
    expect(getObservationView({ following: false, picking: null, routeEnabled: false, subject: walking }).detail)
      .toBe("Carrying logs");
  });

  it("treats camera keys as follow stops and small pointer moves as taps", () => {
    expect(["W", "ArrowLeft", "Escape", "c"].every(isCameraKey)).toBe(true);
    expect(isCameraKey("x")).toBe(false);
    expect(isTap({ x: 0, y: 0 }, { x: 6, y: 5 })).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 9, y: 0 })).toBe(false);
  });

  it("renders the status line and Follow / Stop / Route with their names", () => {
    const store = createExternalStore(getObservationView({
      following: true, picking: null, routeEnabled: true, subject: subject({ route: route(3, 0) })
    }));
    const markup = renderWithI18n(createElement(ObservationContent,
      { store, onFollow: noop, onRoute: noop, onStop: noop }));
    expect(markup).toContain('<p role="status">Carrying logs · Following · Upcoming route (up to 64 waypoints)</p>');
    expect(markup).toContain('aria-label="Follow this worker or ship"');
    expect(markup).toMatch(/aria-label="Follow this worker or ship"[^>]*disabled=""/);
    expect(markup).not.toMatch(/aria-label="Stop following"[^>]*disabled=""/);
    expect(markup).toContain('aria-label="Show the selected worker or ship&#x27;s upcoming route" aria-pressed="true"');
    store.set(getObservationView({ following: false, picking: null, routeEnabled: false, subject: subject() }));
    expect(renderWithI18n(createElement(ObservationContent,
      { store, onFollow: noop, onRoute: noop, onStop: noop }))).not.toContain("upcoming route");
  });

  it("projects and translates the read-only unit decision reason", () => {
    const waiting = subject({ reason: () => "waiting-for-ware" });
    expect(getObservationView({ following: false, picking: null, routeEnabled: false, subject: waiting }).reason)
      .toBe("waiting-for-ware");
    const store = createExternalStore(getObservationView({
      following: false, picking: null, routeEnabled: false, subject: waiting
    }));
    const props = { store, onFollow: noop, onRoute: noop, onStop: noop };
    expect(renderWithI18n(createElement(ObservationContent, props))).toContain("Waiting for materials");
    expect(renderWithI18n(createElement(ObservationContent, props), "hu")).toContain("Anyagra vár");
  });
});
