import { expect, it, vi } from "vitest";

import { createEconomyClient } from "../src/app/cloud/economy-client";
import { dailyQuestClaimBody } from "../src/app/cloud/quest-claim-body";
import { createServerEconomy } from "../src/app/cloud/server-economy";

it("registers aid using a zero-reward request and preserves refusal reasons", async () => {
  const body = { amount: 4, questId: "2026-10-28-0", ware: "planks" };
  const requests: { path: string; body: unknown }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ path: url, body: JSON.parse(init.body as string) });
    if (requests.length === 1) return new Response(JSON.stringify({ prepared: true, questId: body.questId }));
    return new Response(JSON.stringify({ message: "The aid wares are no longer available" }), { status: 409 });
  }) as unknown as typeof globalThis.fetch;
  const client = createEconomyClient({ apiUrl: "http://127.0.0.1:3002", fetch,
    getAccessToken: async () => "fixture-token" });
  const economy = createServerEconomy({ client, startGems: 7 });
  const changed = vi.fn(); economy.onGems(changed);
  expect(await economy.prepareReliefQuest!(body)).toBe(true);
  expect(await economy.prepareReliefQuest!(body)).toBe("The aid wares are no longer available");
  expect(requests).toEqual(Array.from({ length: 2 }, () => ({
    path: "http://127.0.0.1:3002/v1/economy/relief/prepare", body })));
  expect(changed).not.toHaveBeenCalled();
  expect(economy.startGems).toBe(7);
});

const NOW = Date.UTC(2026, 9, 28, 12);

it("marks a relief reward request without granting anything before the server confirms it", async () => {
  const claim = { bonus: 0, material: "planks" as const, questId: "2026-10-28-0", relief: true };
  let sent: unknown;
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ message: "Relief departure verification is pending" }), { status: 409 });
  }) as unknown as typeof globalThis.fetch;
  const economy = createServerEconomy({ now: () => NOW, startGems: 7, client: createEconomyClient({
    apiUrl: "http://127.0.0.1:3002", fetch, getAccessToken: async () => "fixture-token" }) });
  const changed = vi.fn(); economy.onGems(changed);
  expect(await economy.claimQuest(claim)).toBe("Relief departure verification is pending");
  expect(sent).toEqual(dailyQuestClaimBody(claim, NOW));
  expect(sent).toMatchObject({ claim: { questId: "daily:2026-10-28-0" }, relief: true, v: 2 });
  expect(changed).not.toHaveBeenCalled();
});
