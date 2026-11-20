import { afterEach, describe, expect, it, vi } from "vitest";

import { createDepositSignTooltip } from "../src/renderers/three/settlement/deposit-sign-tooltip";

interface FakeElement {
  append: (child: FakeElement) => void;
  attributes: Map<string, string>;
  children: FakeElement[];
  className: string;
  clientHeight: number;
  clientWidth: number;
  getBoundingClientRect: () => { left: number; top: number };
  hidden: boolean;
  offsetHeight: number;
  offsetWidth: number;
  parentElement: FakeElement | null;
  remove: () => void;
  setAttribute: (name: string, value: string) => void;
  style: { transform: string };
  textContent: string;
}

/** Just enough of an HTMLElement for the tooltip: attributes, hidden, text, size and style. */
const createFakeElement = (offsetWidth = 0, offsetHeight = 0) => {
  const element: FakeElement = {
    append: child => { child.parentElement = element; element.children.push(child); },
    attributes: new Map<string, string>(),
    children: [],
    className: "",
    clientHeight: 0,
    clientWidth: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    hidden: false,
    offsetHeight,
    offsetWidth,
    parentElement: null,
    remove: () => {
      const parent = element.parentElement;
      if (parent) parent.children = parent.children.filter(child => child !== element);
      element.parentElement = null;
    },
    setAttribute: (name, value) => { element.attributes.set(name, value); },
    style: { transform: "" },
    textContent: ""
  };
  return element;
};

const setup = () => {
  const label = createFakeElement(120, 30);
  vi.stubGlobal("document", { createElement: () => label });
  const parent = Object.assign(createFakeElement(), {
    clientHeight: 600, clientWidth: 800, getBoundingClientRect: () => ({ left: 100, top: 50 })
  });
  const canvas = { parentElement: parent } as unknown as HTMLCanvasElement;
  const tooltip = createDepositSignTooltip(canvas);
  return { label, parent, tooltip };
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("deposit sign hover tooltip", () => {
  it("mounts a hidden accessible tooltip beside the map canvas", () => {
    const { label, parent } = setup();
    expect(parent.children).toEqual([label]);
    expect(label.className).toBe("deposit-sign-tooltip");
    expect(label.attributes.get("role")).toBe("tooltip");
    expect(label.hidden).toBe(true);
  });

  it("shows the ore name offset from the pointer in canvas-parent coordinates, then hides", () => {
    const { label, tooltip } = setup();
    tooltip.show("Iron deposit", 300, 250);
    expect(label).toMatchObject({ hidden: false, textContent: "Iron deposit" });
    expect(label.style.transform).toBe("translate(214px, 214px)");
    tooltip.hide();
    expect(label.hidden).toBe(true);
    tooltip.show("Gold deposit", 300, 250);
    expect(label).toMatchObject({ hidden: false, textContent: "Gold deposit" });
  });

  it("stays inside the map near its right/bottom and left/top edges", () => {
    const { label, tooltip } = setup();
    tooltip.show("Granite deposit", 895, 645);
    expect(label.style.transform).toBe("translate(680px, 570px)");
    tooltip.show("Coal deposit", -40, -40);
    expect(label.style.transform).toBe("translate(0px, 0px)");
  });

  it("does nothing without a mounted canvas and is removed on dispose", () => {
    const { label, parent, tooltip } = setup();
    tooltip.dispose();
    expect(parent.children).toEqual([]);
    const detached = createDepositSignTooltip({ parentElement: null } as unknown as HTMLCanvasElement);
    detached.show("Coal deposit", 10, 10);
    expect(label.textContent).toBe("");
  });
});
