import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { createIdentityClient } from "../../src/app/account/identity-client";
import { createAppearanceApi } from "../../src/app/settings/seasonal-appearance/api";

/** Real identity roles, route authorization and PostgreSQL persistence; disposable services, no browser. */
const { startAcceptanceStack } = await import(String("../../../island-of-settlers-local-dev/src/acceptance-stack.ts"));
const stack = await startAcceptanceStack();
const output = resolve(import.meta.dirname,
  "../../../resources/project-reviews/global-winter-2026-11-02/server");
const pg = createRequire(import.meta.url)("../../../island-of-settlers-api/node_modules/pg");
let closeIndependentPool: (() => Promise<void>) | undefined;

const register = async (name: string) => {
  const identity = createIdentityClient({ identityUrl: stack.identityUrl, lock: run => run() });
  const suffix = randomBytes(5).toString("hex");
  const registered = await identity.register({ displayName: `${name}${suffix}`, email: `${name}-${suffix}@example.test`,
    nation: "roman", password: randomBytes(24).toString("base64url") });
  assert(registered.ok, `${name} registration failed`);
  return { identity, role: registered.account.role };
};

try {
  const ready = await fetch(`${stack.apiUrl}/ready`);
  assert.equal(ready.status, 200, "Current migrations must make the API ready");
  const guest = createAppearanceApi({ apiUrl: stack.apiUrl });
  assert.equal((await guest.read()).season.fixedSeason, "summer");
  const admin = await register("Admin"), player = await register("Player");
  assert.equal(admin.role, "admin");
  assert.equal(player.role, "player");
  const adminApi = createAppearanceApi({ apiUrl: stack.apiUrl, getAccessToken: admin.identity.accessToken });
  const playerApi = createAppearanceApi({ apiUrl: stack.apiUrl, getAccessToken: player.identity.accessToken });
  assert.equal((await adminApi.setGlobalWinter(true)).season.fixedSeason, "winter");
  assert.equal((await playerApi.read()).season.fixedSeason, "winter");
  assert.equal((await createAppearanceApi({ apiUrl: stack.apiUrl }).read()).season.fixedSeason, "winter");
  const independentPool = new pg.Pool(stack.pool.options);
  closeIndependentPool = () => independentPool.end();
  const saved = await independentPool.query("SELECT fixed_season FROM game.appearance_settings WHERE singleton");
  assert.equal(saved.rows[0].fixed_season, "winter", "A separate PostgreSQL connection must read the enabled flag");
  await assert.rejects(() => playerApi.setGlobalWinter(false), { status: 403 });
  assert.equal((await guest.read()).season.fixedSeason, "winter",
    "The player's denied mutation must leave winter on");
  assert.equal((await adminApi.setGlobalWinter(false)).season.fixedSeason, "summer");
  const final = await independentPool.query(`SELECT count(*)::int AS count,
    bool_and(fixed_season = 'summer') AS disabled FROM game.appearance_settings`);
  assert.equal(final.rows[0].count, 1);
  assert.equal(final.rows[0].disabled, true);
  assert.equal((await playerApi.read()).season.fixedSeason, "summer");
  const report = { adminRole: admin.role, anonymousRead: true, apiReady: true, finalGlobalWinter: false,
    playerMutationStatus: 403, playerRole: player.role, separateConnectionRead: true, singletonRows: final.rows[0].count };
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await closeIndependentPool?.();
  await stack.close();
}
