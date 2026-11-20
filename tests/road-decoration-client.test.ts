import { describe, expect, it, vi } from "vitest";

import { createRoadDecorationClient, type RoadDecorationTransport } from "../src/app/cloud/road-decoration-client";

const slotId = "00000000-0000-4000-8000-000000000001", key = "00000000-0000-4000-8000-000000000002";
const action = { kind: "pick-up" as const, uid: 12 };
const receipt = () => ({ ok: true as const, slotId, islandKey: "home" as const, revision: 8,
  settlement: { restored: true }, result: { returned: 1 }, wallet: { gems: 50, items: {} } });
const storage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const setup = (mutate: RoadDecorationTransport["mutate"], saved = storage()) => {
  const apply = vi.fn(), adopt = vi.fn(async (_revision: number, run: () => void) => { run(); return { ok: true }; });
  const client = createRoadDecorationClient({ accountId: "account", slotId, storage: saved, transport: { mutate },
    revision: () => 7, adopt, newKey: () => key });
  return { client, saved, apply, adopt };
};

describe("road decoration receipt authority", () => {
  it("retries the same exact request after a lost commit response and adopts once", async () => {
    const send = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(receipt());
    const { adopt, apply, client, saved } = setup(send);
    expect(await client.mutate("home", action, apply)).toMatchObject({ ok: true, reload: false });
    expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);
    expect(adopt).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce(); expect(saved.values.size).toBe(0);
  });
  it("retains an ambiguous request across reload and refuses a different island/action", async () => {
    const first = setup(vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await first.client.mutate("home", action, first.apply)).toMatchObject({ ok: false, pending: true });
    const send = vi.fn().mockResolvedValue(receipt()), next = setup(send, first.saved);
    expect(await next.client.mutate("colony-1", action, next.apply)).toMatchObject({ ok: false, pending: true });
    expect(send).not.toHaveBeenCalled();
    expect(await next.client.reconcile()).toMatchObject({ confirmed: true }); expect(next.saved.values.size).toBe(0);
  });
  it("never applies a mismatched island receipt or stale world body", async () => {
    const malformed = setup(async () => ({ ...receipt(), islandKey: "colony-1" }));
    expect(await malformed.client.mutate("home", action, malformed.apply)).toMatchObject({ ok: false, pending: true });
    expect(malformed.apply).not.toHaveBeenCalled();
    const advanced = setup(async () => ({ ...receipt(), settlement: null }));
    expect(await advanced.client.mutate("home", action, advanced.apply)).toMatchObject({ ok: true, reload: true });
    expect(advanced.apply).not.toHaveBeenCalled(); expect(advanced.saved.values.size).toBe(1);
  });
});
