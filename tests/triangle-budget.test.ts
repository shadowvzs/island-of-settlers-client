import { describe, expect, it } from "vitest";

import { checkTriangleBudget } from "../tools/bench/triangle-budget";

describe("triangle budget tolerance", () => {
  it("passes under the budget, warns up to 15% over and fails beyond", () => {
    expect(checkTriangleBudget(2299, 2300)).toBe("ok");
    expect(checkTriangleBudget(2386, 2300)).toBe("warn");
    expect(checkTriangleBudget(2645, 2300)).toBe("warn");
    expect(checkTriangleBudget(2646, 2300)).toBe("fail");
  });
});
