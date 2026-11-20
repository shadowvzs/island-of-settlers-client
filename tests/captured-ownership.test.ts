import { expect, it } from "vitest";

import {
  markCapturedSettlementCopied, takeCapturedSettlementOwnership
} from "../src/app/save-store/captured-ownership";

it("transfers a captured settlement snapshot's ownership exactly once", () => {
  const snapshot = {};
  expect(takeCapturedSettlementOwnership(snapshot)).toBe(false);
  markCapturedSettlementCopied(snapshot);
  expect(takeCapturedSettlementOwnership(snapshot)).toBe(true);
  expect(takeCapturedSettlementOwnership(snapshot)).toBe(false);
});
