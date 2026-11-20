import { describe, expect, it } from "vitest";

import { translateDomainMessage } from "../src/shared/i18n/domain";
import { translateMessage } from "../src/shared/i18n/translate";

const LOGS = { id: "test.logs", message: "{count, plural, one {# log} other {# logs}} for {building}" };

describe("source fallback without a Lingui instance", () => {
  it("renders the plural count `#` and named values", () => {
    expect(translateMessage(undefined, LOGS, { building: "Sawmill", count: 1 })).toBe("1 log for Sawmill");
    expect(translateMessage(undefined, LOGS, { building: "Sawmill", count: 3 })).toBe("3 logs for Sawmill");
  });

  it("is the same fallback for domain messages", () => {
    expect(translateDomainMessage).toBe(translateMessage);
    expect(translateDomainMessage(undefined, LOGS, { building: "Mill", count: 2 })).toBe("2 logs for Mill");
  });

  it("returns the source unchanged without values", () => {
    expect(translateMessage(undefined, LOGS)).toBe(LOGS.message);
  });
});
