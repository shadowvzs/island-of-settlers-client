import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { DemolishConfirm } from "../src/app/settlement-ui/demolish-confirm/demolish-confirm";
import {
  createDemolishConfirmation,
  getDemolishConfirmationText,
  isDemolishQuestionStale,
  isInsideDemolishConfirmation,
  listenForDemolishDismissal
} from "../src/app/settlement-ui/demolish-confirmation-helpers";
import { renderWithI18n } from "./helpers/render-with-i18n";

const keyDown = (key: string) => Object.assign(new Event("keydown", { cancelable: true }), { key });

/** Stands in for a DOM element: `closest` answers whether it sits inside the panel. */
class FakeElement extends EventTarget {
  constructor(private readonly inside: boolean) { super(); }
  closest() { return this.inside ? this : null; }
}

const woodcutter = (id: string, completed?: boolean) => ({ completed, id, type: 3 });

describe("demolish confirmation", () => {
  it("asks first and demolishes only after an explicit confirm", () => {
    const confirmation = createDemolishConfirmation();
    const onChange = vi.fn();
    confirmation.subscribe(onChange);
    expect(confirmation.confirm("7")).toBe(false);
    confirmation.request(woodcutter("7"));
    expect(confirmation.pending()).toBe("7");
    confirmation.request(woodcutter("7"));
    expect(confirmation.confirm("8")).toBe(false);
    expect(confirmation.confirm("7")).toBe(true);
    expect(confirmation.pending()).toBeNull();
    expect(confirmation.confirm("7")).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("names the building in the nation's words and switches to another building", () => {
    const confirmation = createDemolishConfirmation();
    confirmation.request(woodcutter("1", false), "roman");
    expect(confirmation.getSnapshot()).toMatchObject({ text: { confirmLabel: "Remove" }, type: 3, uid: "1" });
    confirmation.request(woodcutter("2"), "roman");
    expect(confirmation.pending()).toBe("2");
    confirmation.cancel();
    expect(confirmation.getSnapshot()).toBeNull();
  });

  it("cancels on Escape and keeps that Escape from closing windows", () => {
    const target = new EventTarget();
    const onCancel = vi.fn();
    const stop = listenForDemolishDismissal(target, onCancel);
    target.dispatchEvent(keyDown("Enter"));
    expect(onCancel).not.toHaveBeenCalled();
    const escape = keyDown("Escape");
    target.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    stop();
    target.dispatchEvent(keyDown("Escape"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on a press elsewhere but not inside the panel", () => {
    const inside = new FakeElement(true), kept = vi.fn();
    listenForDemolishDismissal(inside, kept);
    inside.dispatchEvent(new Event("pointerdown"));
    expect(kept).not.toHaveBeenCalled();
    const outside = new FakeElement(false), dismissed = vi.fn();
    listenForDemolishDismissal(outside, dismissed);
    outside.dispatchEvent(new Event("pointerdown"));
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it("words the question for buildings and construction sites", () => {
    expect(getDemolishConfirmationText("Woodcutter", true)).toEqual({
      confirmLabel: "Demolish", keepLabel: "Keep", question: "Demolish Woodcutter?",
      title: "Demolish building"
    });
    expect(getDemolishConfirmationText("Woodcutter", false).question)
      .toBe("Remove the Woodcutter construction site?");
  });

  it("recognises presses inside the panel", () => {
    expect(isInsideDemolishConfirmation(new FakeElement(true))).toBe(true);
    expect(isInsideDemolishConfirmation(new FakeElement(false))).toBe(false);
    expect(isInsideDemolishConfirmation(new EventTarget())).toBe(false);
    expect(isInsideDemolishConfirmation(null)).toBe(false);
  });

  it("ends the question when its building disappears or loses the focus", () => {
    const buildings = [{ id: "4" }, { id: "9" }];
    expect(isDemolishQuestionStale(null, null, buildings)).toBe(false);
    expect(isDemolishQuestionStale("4", "4", buildings)).toBe(false);
    expect(isDemolishQuestionStale("4", "9", buildings)).toBe(true);
    expect(isDemolishQuestionStale("4", null, buildings)).toBe(true);
    expect(isDemolishQuestionStale("4", "4", [{ id: "9" }])).toBe(true);
    expect(isDemolishQuestionStale("4", "4", undefined)).toBe(true);
  });

  it("renders the subject and the Keep / Demolish choices with their data attributes", () => {
    const confirmation = createDemolishConfirmation();
    expect(renderWithI18n(createElement(DemolishConfirm, { confirmation, onDemolish: () => {} }))).toBe("");
    confirmation.request(woodcutter("5"), "roman");
    const name = confirmation.getSnapshot()!.name;
    const markup = renderWithI18n(createElement(DemolishConfirm, { confirmation, onDemolish: () => {} }));
    expect(markup).toContain(`<strong>${name}</strong>`);
    expect(markup).toContain(`aria-label="Keep ${name}" class="settlement-ui__button settlement-ui__demolish-choice" `
      + 'data-demolish-confirm-no="5"');
    expect(markup).toContain(`aria-label="Demolish ${name}"`);
    expect(markup).toContain('data-demolish-confirm-yes="5"');
  });
});
