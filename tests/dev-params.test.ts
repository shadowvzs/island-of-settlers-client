import { describe, expect, it } from "vitest";

import { readAppParams } from "../src/app/app-params";
import { readDevParams } from "../src/app/dev-params";

/** Player launches ignore dev/test switches; only the admin page or local dev entry parses them. */
describe("player and development URL parameters", () => {
  it("parses product island/seed/map parameters in every entry", () => {
    expect(readAppParams("?seed=42&landform=peninsula&map=slot-7")).toMatchObject({
      map: "slot-7",
      seed: 42,
      seedFromUrl: true,
      island: expect.objectContaining({ landform: "peninsula" })
    });
  });

  it("keeps dev/test switches at product defaults for the player entry", () => {
    const params = readAppParams(
      "?stress=1&garden=1&horse=1&reveal=1&unlockall=1&quality=minimal&time=night&rain=1&snow=1&view=1,2,3"
    );
    expect(params).toMatchObject({
      garden: false,
      horse: false,
      quality: null,
      rain: false,
      reveal: false,
      sceneDepth: false,
      snow: false,
      stress: false,
      unlockAll: false,
      view: null
    });
  });

  it("reads the R12a resolved depth request for timing", () => {
    expect(readDevParams("?depth=1")).toEqual({ sceneDepth: true });
    expect(readDevParams("?depth=0")).toEqual({ sceneDepth: false });
  });

  it("reads the R12b ambient occlusion A/B, null for other values", () => {
    expect(readDevParams("?ao=soft")).toEqual({ ambientOcclusion: "soft" });
    expect(readDevParams("?ao=strong")).toEqual({ ambientOcclusion: "strong" });
    expect(readDevParams("?ao=dramatic")).toEqual({ ambientOcclusion: "dramatic" });
    expect(readDevParams("?ao=on")).toEqual({ ambientOcclusion: "soft" });
    expect(readDevParams("?ao=off")).toEqual({ ambientOcclusion: "off" });
    expect(readDevParams("?ao=1")).toEqual({ ambientOcclusion: null });
    expect(readDevParams("?ssr=on")).toEqual({ waterReflections: "on" });
    expect(readDevParams("?ssr=off")).toEqual({ waterReflections: "off" });
    expect(readDevParams("?ssr=1")).toEqual({ waterReflections: null });
  });

  it("parses only the dev switches that the URL actually names", () => {
    expect(readDevParams("?stress=1&garden=0&quality=minimal&time=night&view=1,2,3")).toEqual({
      garden: false,
      hour: 23,
      quality: "minimal",
      stress: true,
      view: { x: 1, z: 2, zoom: 3 }
    });
    expect(readDevParams("")).toEqual({});
  });

  it("reads the R08 shadow cascade A/B switch, nothing for other values", () => {
    expect(readDevParams("?cascades=1")).toEqual({ shadowCascades: 1 });
    expect(readDevParams("?cascades=3")).toEqual({ shadowCascades: 3 });
    expect(readDevParams("?cascades=4")).toEqual({ shadowCascades: null });
    expect(readAppParams("?cascades=1").shadowCascades).toBeNull();
  });

  it("reads the GL diagnostics and weather switches for admin/dev", () => {
    expect(readDevParams("?gldebug=1&glemulate=mali&ground=lite&fogbanks=0&rain=1&snow=1"))
      .toMatchObject({
        fogBanks: false,
        glDebug: true,
        glEmulate: "mali",
        ground: "lite",
        rain: true,
        snow: true
      });
  });

  it("keeps the C02 ring rollback on the instanced default outside dev entries", () => {
    expect(readAppParams("?rings=individual").workerRingMode).toBe("instanced");
    expect(readDevParams("?rings=individual").workerRingMode).toBe("individual");
    expect(readDevParams("?rings=instanced").workerRingMode).toBe("instanced");
    expect(readDevParams("")).not.toHaveProperty("workerRingMode");
  });

  it("keeps the C06b far-props rollback on the far default outside dev entries", () => {
    expect(readAppParams("?farprops=exact").farPropsMode).toBe("far");
    expect(readDevParams("?farprops=exact").farPropsMode).toBe("exact");
    expect(readDevParams("?farprops=far").farPropsMode).toBe("far");
    expect(readDevParams("")).not.toHaveProperty("farPropsMode");
  });
});
