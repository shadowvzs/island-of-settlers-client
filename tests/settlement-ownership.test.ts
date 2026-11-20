import { describe, expect, it } from "vitest";

import { PLAYER_FACTION as FOG_PLAYER_FACTION } from "../src/shared/settlement/player-fog";
import {
  actorOwnerOf, hasEconomy, ownerOf, PLAYER_FACTION, sameOwner, servesEconomyOf
} from "../src/shared/settlement/settlement-ownership";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { economyScenario } from "./helpers/economy-factions";

type OptionsContext = Pick<SettlementContext, "options">;
const withEconomies = (economyFactions?: readonly number[]) =>
  ({ options: { world: { scenario: economyScenario(economyFactions) } } }) as OptionsContext;
const soldierFactions = (factions: Record<number, number>) =>
  ({ military: { factionOf: (uid: number) => factions[uid] } }) as unknown as Pick<SettlementContext, "military">;

/** EAI1b step b1: the one ownership source that replaces the `militaryFaction ?? 0` idiom. */
describe("settlement ownership", () => {
  it("reads an unset owner as the player without telling it apart from a fortified player site", () => {
    expect(PLAYER_FACTION).toBe(0);
    expect(FOG_PLAYER_FACTION).toBe(PLAYER_FACTION);
    expect(ownerOf({})).toBe(PLAYER_FACTION);
    expect(ownerOf({ militaryFaction: 0 })).toBe(PLAYER_FACTION);
    expect(ownerOf({ militaryFaction: 3 })).toBe(3);
  });

  it("compares two owners", () => {
    expect(sameOwner({}, { militaryFaction: 0 })).toBe(true);
    expect(sameOwner({ militaryFaction: 2 }, { militaryFaction: 2 })).toBe(true);
    expect(sameOwner({}, { militaryFaction: 1 })).toBe(false);
  });

  it("gives a soldier its combat faction and a civilian its saved hostile faction", () => {
    const context = soldierFactions({ 7: 2 });
    expect(actorOwnerOf(context, { job: "Soldier", uid: 7 })).toBe(2);
    expect(actorOwnerOf(context, { job: "Soldier", uid: 8 })).toBe(PLAYER_FACTION);
    expect(actorOwnerOf(context, { hostileCivilianFaction: 2, job: "Soldier", uid: 8 })).toBe(PLAYER_FACTION);
    expect(actorOwnerOf(context, { hostileCivilianFaction: 4, job: "Carrier", uid: 7 })).toBe(4);
    expect(actorOwnerOf(context, { job: "Woodcutter", uid: 9 })).toBe(PLAYER_FACTION);
    expect(actorOwnerOf({}, { job: "Soldier", uid: 1 })).toBe(PLAYER_FACTION);
  });

  it("runs an economy for the player always and for a computer faction only when the island enables it", () => {
    expect(hasEconomy(withEconomies(), PLAYER_FACTION)).toBe(true);
    expect(hasEconomy(withEconomies(), 1)).toBe(false);
    expect(hasEconomy(withEconomies([2]), 1)).toBe(false);
    expect(hasEconomy(withEconomies([2]), 2)).toBe(true);
  });

  it("lets a depot of a faction without an economy keep serving every economy, as before (BD1 gap kept)", () => {
    const playerOnly = withEconomies();
    expect(servesEconomyOf(playerOnly, {}, PLAYER_FACTION)).toBe(true);
    expect(servesEconomyOf(playerOnly, { militaryFaction: 1 }, PLAYER_FACTION)).toBe(true);
    const twoEconomies = withEconomies([1]);
    expect(servesEconomyOf(twoEconomies, { militaryFaction: 1 }, PLAYER_FACTION)).toBe(false);
    expect(servesEconomyOf(twoEconomies, {}, 1)).toBe(false);
    expect(servesEconomyOf(twoEconomies, { militaryFaction: 1 }, 1)).toBe(true);
    expect(servesEconomyOf(twoEconomies, { militaryFaction: 3 }, 1)).toBe(true);
  });
});
