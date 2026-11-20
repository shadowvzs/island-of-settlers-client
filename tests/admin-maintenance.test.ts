import { expect, it } from "vitest";

import { confirmationMatches } from "../src/app/admin/helpers";
import { BROWSER_LOG_LIMIT, BROWSER_TOOLS, SERVER_TOOLS } from "../src/app/admin/maintenance/constants";
import {
  appendBrowserLog, auditRows, campaignRows, catchUpBlock, expectedConfirmation, starterRows, toolBlock
} from "../src/app/admin/maintenance/helpers";
import type { AdminSlot, MaintenanceCapabilities } from "../src/app/admin/maintenance/maintenance-ports";
import { canResetProgress } from "../src/app/admin/users/helpers";

const capabilities = (databaseReset: boolean, destructiveActions = false): MaintenanceCapabilities => ({
  catchUp: true,
  confirmHost: "settlers.example",
  flags: {
    databaseReset: { enabled: databaseReset, name: "DEBUG_DATABASE_RESET" },
    destructiveActions: { enabled: destructiveActions, name: "ADMIN_DESTRUCTIVE_ACTIONS" }
  }
});

const spec = (id: string) => [...SERVER_TOOLS, ...BROWSER_TOOLS].find(entry => entry.id === id)!;

it("a flag-less server blocks M1/M2 with the flag's name; M3 is a placeholder; M7/M11/M12 stay open", () => {
  expect(toolBlock(spec("M1"), capabilities(false))).toEqual({ flag: "DEBUG_DATABASE_RESET", kind: "flag" });
  expect(toolBlock(spec("M2"), capabilities(false))).toEqual({ flag: "DEBUG_DATABASE_RESET", kind: "flag" });
  expect(toolBlock(spec("M1"), capabilities(true))).toBeNull();
  expect(toolBlock(spec("M3"), capabilities(true))).toEqual({ kind: "placeholder" });
  for (const id of ["M7", "M11", "M12", "M12b"]) expect(toolBlock(spec(id), capabilities(false))).toBeNull();
  expect(BROWSER_TOOLS.map(tool => tool.id)).toEqual(["M11", "M12", "M12b"]);
});

it("typed confirmations: the host name for M1/M2, fixed words for M7/M12, none for M11; exact match only", () => {
  expect(expectedConfirmation(spec("M1"), capabilities(true))).toBe("settlers.example");
  expect(expectedConfirmation(spec("M7"), null)).toBe("my saves");
  expect(expectedConfirmation(spec("M12"), null)).toBe("reset");
  expect(expectedConfirmation(spec("M11"), null)).toBeNull();
  expect(confirmationMatches("settlers.example", "settlers.example")).toBe(true);
  expect(confirmationMatches("Settlers.example", "settlers.example")).toBe(false);
  expect(confirmationMatches(" reset", "reset")).toBe(false);
  expect(confirmationMatches("", null)).toBe(true);
});

it("the browser log keeps the newest entries and survives a damaged value", () => {
  let log: string | null = "not json";
  for (let index = 0; index < BROWSER_LOG_LIMIT + 3; index++)
    log = appendBrowserLog(log, { action: `a${index}`, at: "2026-11-12T00:00:00.000Z" });
  const entries = JSON.parse(log!) as { action: string }[];
  expect(entries).toHaveLength(BROWSER_LOG_LIMIT);
  expect(entries.at(-1)!.action).toBe(`a${BROWSER_LOG_LIMIT + 2}`);
});

it("audit rows show params beside the action and mark a sessionless refusal", () => {
  const [row] = auditRows([{
    action: "account.reset", adminAccount: null, at: "2026-11-12T10:00:00.000Z", id: "7",
    params: { wallet: true }, result: "refused 401", target: "abc"
  }]);
  expect(row).toMatchObject({
    action: "account.reset (wallet=true)", result: "refused 401", target: "abc", who: null
  });
});

it("content rows: campaigns toggle Ready/Draft; starter history newest first, no rollback of the current", () => {
  expect(campaignRows([{ id: "a", name: "A", revision: 1, state: "ready" },
    { id: "b", name: "B", revision: 2, state: "draft" }]).map(row => row.nextState)).toEqual(["draft", "ready"]);
  const revision = (number: number) => ({
    createdAt: null, hash: `h${number}`, mapId: "m", name: "Map", revision: number
  });
  const rows = starterRows({ current: revision(2), revisions: [revision(1), revision(3), revision(2)] });
  expect(rows.map(row => [row.revision.revision, row.current])).toEqual([[3, false], [2, true], [1, false]]);
  expect(starterRows(null)).toEqual([]);
});

it("catch-up needs the server's catch-up and a stored build; M4 is offered for existing non-admins only", () => {
  const slot: AdminSlot = { flagged: false, id: "s", name: "Home", revision: 2, slotNo: 1, sourceVersion: "abc",
    updatedAt: "2026-11-12T00:00:00.000Z", verifiedRevision: null };
  expect(catchUpBlock(slot, capabilities(false))).toBeNull();
  expect(catchUpBlock({ ...slot, sourceVersion: null }, capabilities(false))).toBe("noVersion");
  expect(catchUpBlock(slot, { ...capabilities(false), catchUp: false })).toBe("noCatchUp");
  const account = {
    displayName: "Marcus", id: "1", lastSeenAt: null, role: "player" as const, status: "active" as const
  };
  expect(canResetProgress(account)).toBe(true);
  expect(canResetProgress({ ...account, role: "admin" })).toBe(false);
  expect(canResetProgress({ ...account, status: "deleted" })).toBe(false);
});
