import { expect, it } from "vitest";

import {
  getPortraitStyle, PORTRAIT_COLUMNS, PORTRAIT_FRAMES, PORTRAIT_ROWS, portraitFrameCell, portraitSheetName,
  snapToDevicePixels
} from "../src/app/settlement-ui/player-hud/helpers";

it("lays the 120 portrait frames out as 10 columns x 12 rows, row by row, and wraps the loop", () => {
  expect([PORTRAIT_COLUMNS, PORTRAIT_ROWS]).toEqual([10, 12]);
  expect(PORTRAIT_COLUMNS * PORTRAIT_ROWS).toBe(PORTRAIT_FRAMES);
  expect(portraitFrameCell(0)).toEqual({ column: 0, row: 0 });
  expect(portraitFrameCell(9)).toEqual({ column: 9, row: 0 });
  expect(portraitFrameCell(10)).toEqual({ column: 0, row: 1 });
  expect(portraitFrameCell(119)).toEqual({ column: 9, row: 11 });
  expect(portraitFrameCell(120)).toEqual({ column: 0, row: 0 });
});

it("keys each animated sheet by nation and selected face gender", () => {
  expect(portraitSheetName("roman", "male")).toBe("roman-male");
  expect(portraitSheetName("viking", "female")).toBe("viking-female");
  expect(portraitSheetName("nubian", "female")).toBe("nubian-female");
  expect(portraitSheetName("unknown", "female")).toBe("roman-female");
  expect(portraitSheetName("japanese", "unknown")).toBe("japanese-female");
});

it.each(["indigenous", "chinese", "persian", "maya"])(
  "uses the published female and male %s sheets instead of the former Roman fallback", nation => {
    for (const gender of ["female", "male"]) {
      expect(portraitSheetName(nation, gender)).toBe(`${nation}-${gender}`);
      expect(getPortraitStyle(nation, gender, "92px").backgroundImage)
        .not.toBe(getPortraitStyle("roman", gender, "92px").backgroundImage);
    }
  }
);

it("keeps every sheet offset on whole device pixels at common pixel ratios", () => {
  for (const ratio of [1, 1.25, 1.5, 2, 3]) {
    const size = snapToDevicePixels(92, ratio);
    for (let frame = 0; frame < PORTRAIT_FRAMES; frame++) {
      const { column, row } = portraitFrameCell(frame);
      expect(Number.isInteger(Math.round(column * size * ratio * 1e6) / 1e6)).toBe(true);
      expect(Number.isInteger(Math.round(row * size * ratio * 1e6) / 1e6)).toBe(true);
    }
  }
});
