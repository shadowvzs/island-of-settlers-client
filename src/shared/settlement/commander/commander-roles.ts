import { FLANK_LIMITS } from "../../balance/commander-profiles";
import {
  RESERVE_HEALTH, RESERVE_MORALE, RESERVE_MORALE_COMMITMENT, ROLE_COMMITMENT
} from "../../balance/commander-roles";
import { MORALE_BASE } from "../../balance/morale";
import type { MilitaryTroopType } from "../military-combat-rules";
import { strengthOf } from "./commander-squads";
import type { CommanderRole, CommanderRoleUse, CommanderUnit, RoleGroupMemory } from "./commander-types";

/** The fixed order of a squad's role groups (one per troop type). */
const GROUP_TYPES: readonly MilitaryTroopType[] = ["shield", "heavy", "archer", "cavalry"];

/**
 * The role a troop type plays by default (A14 plan §3.1). Swordsmen (the fastest foot) flank beside axemen
 * (`assignRoles`); ordinary cavalry is retired (HORSE-RETIREMENT-01) and keeps the flank only for old saves.
 */
const BASE_ROLES: Readonly<Record<MilitaryTroopType, CommanderRole>> = {
  archer: "overwatch",
  cavalry: "flank",
  heavy: "front",
  shield: "front"
};

/** One troop type of a squad: its members (uid order), strength, mean health share and mean morale (0-100). */
export interface RoleGroup {
  type: MilitaryTroopType;
  members: CommanderUnit[];
  strength: number;
  health: number;
  morale: number;
  role: CommanderRole;
  /** In reserve for its morale alone (A14-2: a morale order, not commander churn). */
  moraleRelief: boolean;
}

/**
 * Splits squads into role groups by troop type. The groups and their member arrays are reused: the
 * returned list is valid until the next `split`.
 */
export const createRoleGroupSplitter = () => {
  const pool = GROUP_TYPES.map(
    (type): RoleGroup => ({
      health: 0, members: [], morale: 0, moraleRelief: false, role: BASE_ROLES[type], strength: 0, type
    })
  );
  const groups: RoleGroup[] = [];
  return (squad: readonly CommanderUnit[]): readonly RoleGroup[] => {
    for (const group of pool) {
      group.members.length = 0;
      group.health = 0;
      group.morale = 0;
      group.moraleRelief = false;
      group.strength = 0;
      group.role = BASE_ROLES[group.type];
    }
    for (const unit of squad) {
      const group = pool[GROUP_TYPES.indexOf(unit.type)]!;
      group.members.push(unit);
      group.health += unit.health;
      group.morale += unit.morale ?? MORALE_BASE;
      group.strength += strengthOf(unit);
    }
    groups.length = 0;
    for (const group of pool) {
      if (!group.members.length) continue;
      group.health /= group.members.length;
      group.morale /= group.members.length;
      groups.push(group);
    }
    return groups;
  };
};

/** The group's role at the squad's last decision. */
const previousRoleOf = (previous: readonly RoleGroupMemory[] | undefined, type: MilitaryTroopType) =>
  previous?.find((group) => group.type === type)?.role;

/**
 * Wounded or shaken (A14 plan §4.3: the reserve replaces a front whose morale mean is low); a standing reserve
 * keeps the role within the commitment margins.
 */
const reliefOf = (group: RoleGroup, previous: readonly RoleGroupMemory[] | undefined) => {
  const standing = previousRoleOf(previous, group.type) === "reserve";
  const health = standing ? RESERVE_HEALTH + ROLE_COMMITMENT : RESERVE_HEALTH;
  const morale = standing ? RESERVE_MORALE + RESERVE_MORALE_COMMITMENT : RESERVE_MORALE;
  if (group.health < health) return "wounded";
  return group.morale < morale ? "shaken" : undefined;
};
const needsRelief = (group: RoleGroup, previous: readonly RoleGroupMemory[] | undefined) =>
  reliefOf(group, previous) !== undefined;

/** The weakest front group; the standing reserve keeps the role unless another is clearly weaker. */
const weakestFront = (groups: readonly RoleGroup[], previous: readonly RoleGroupMemory[] | undefined) => {
  let weakest: RoleGroup | undefined;
  let weakestValue = Infinity;
  for (const group of groups) {
    if (group.role !== "front") continue;
    const standing = previousRoleOf(previous, group.type) === "reserve";
    const value = standing ? group.strength * (1 - ROLE_COMMITMENT) : group.strength;
    if (value >= weakestValue) continue;
    weakest = group;
    weakestValue = value;
  }
  return weakest;
};

/**
 * Riders are retired (HORSE-RETIREMENT-01): beside an axeman front the swordsmen, the fastest foot (1.4
 * tiles/s), take the flank, unless they outnumber the axemen by more than the level's `flankLimit` (then both
 * hold the front and the weaker stands in reserve, as before).
 */
const flankSwordsmen = (
  groups: readonly RoleGroup[], previous: readonly RoleGroupMemory[] | undefined, flankLimit: number
) => {
  const swordsmen = groups.find((group) => group.type === "shield");
  const axemen = groups.find((group) => group.type === "heavy");
  if (swordsmen?.role !== "front" || axemen?.role !== "front") return;
  // Swordsmen that already hold the front (or the reserve) stay with it: leaving a fight to walk round the line
  // is not a flank. A flank keeps flanking within `ROLE_COMMITMENT` of the even count.
  const before = previousRoleOf(previous, "shield");
  if (before !== undefined && before !== "flank") return;
  const limit = axemen.members.length * flankLimit * (before === "flank" ? 1 + ROLE_COMMITMENT : 1);
  if (swordsmen.members.length <= limit) swordsmen.role = "flank";
};

/**
 * Assigns each group of a mixed squad its role (in place): by troop type, then the reserve. A squad of one
 * type keeps its type's role. Wounded groups (health share under `RESERVE_HEALTH`) or shaken ones (mean
 * morale under `RESERVE_MORALE`) stand in reserve while another group still fights; swordsmen flank beside
 * an axeman front they do not outnumber; of two front groups the weaker one stands in reserve. A standing
 * reserve keeps its role within `ROLE_COMMITMENT` (no flip-flop). `roleUse` is the level's (A14 plan §7): a
 * commander that uses front and overwatch only keeps every group at its type's role, flanks in the front.
 */
export const assignRoles = (
  groups: readonly RoleGroup[], previous: readonly RoleGroupMemory[] | undefined, roleUse: CommanderRoleUse = "all"
) => {
  if (roleUse === "frontAndOverwatch") {
    for (const group of groups) if (group.role === "flank") group.role = "front";
    return;
  }
  // A flank that walked away from its squad (a squad of its own now, keeping the squad memory) stays a flank.
  if (groups.length === 1 && previousRoleOf(previous, groups[0]!.type) === "flank") groups[0]!.role = "flank";
  if (groups.length < 2) return;
  let relieved = 0;
  for (const group of groups) if (needsRelief(group, previous)) relieved++;
  if (relieved < groups.length)
    for (const group of groups) {
      const relief = reliefOf(group, previous);
      if (!relief) continue;
      group.role = "reserve";
      group.moraleRelief = relief === "shaken";
    }
  flankSwordsmen(groups, previous, FLANK_LIMITS[roleUse]);
  let fronts = 0;
  for (const group of groups) if (group.role === "front") fronts++;
  if (fronts < 2) return;
  weakestFront(groups, previous)!.role = "reserve";
};
