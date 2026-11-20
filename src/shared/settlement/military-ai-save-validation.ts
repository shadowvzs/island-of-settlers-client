import { MAX_DECISION_INTERVAL } from "../balance/commander-profiles";
import { MAP_SIDE_RANGE } from "../world/save/map-format";
import { isSaveObject } from "./save-validation";

/** JSON-safe controller snapshots are validated before any live military state is replaced. */
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12;
const integer = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value) && value >= 0;
const point = (value: unknown) =>
  isSaveObject(value) &&
  finite(value.x) &&
  finite(value.z) &&
  Math.abs(value.x) <= 2048 &&
  Math.abs(value.z) <= 2048;
const order = (value: unknown) =>
  typeof value === "string" && ["move", "attackMove", "retreat"].includes(value);
const action = (value: unknown) =>
  typeof value === "string" && ["attack", "defend", "regroup", "retreat"].includes(value);
const troopType = (value: unknown) =>
  typeof value === "string" && ["shield", "heavy", "archer", "cavalry"].includes(value);
const role = (value: unknown) =>
  typeof value === "string" && ["front", "overwatch", "flank", "reserve"].includes(value);
/** A14-1 role groups of a squad memory: at most one per troop type. */
const roleGroups = (value: unknown) => {
  if (value === undefined) return true;
  const types = new Set<unknown>();
  return array(value, 4, (group) => {
    if (!isSaveObject(group) || !troopType(group.type) || types.has(group.type) || !role(group.role)) return false;
    types.add(group.type);
    return integer(group.age) && group.age <= 255 && (group.point === undefined || point(group.point)) &&
      (group.strike === undefined || (integer(group.strike) && group.strike <= 255));
  });
};
const array = (
  value: unknown,
  maximum: number,
  valid: (entry: unknown) => boolean
): value is unknown[] => Array.isArray(value) && value.length <= maximum && value.every(valid);
const pairs = (
  value: unknown,
  maximum: number,
  key: (entry: unknown) => boolean,
  valid: (entry: unknown) => boolean
) => {
  const seen = new Set<unknown>();
  return array(value, maximum, (entry) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !key(entry[0]) ||
      seen.has(entry[0]) ||
      !valid(entry[1])
    )
      return false;
    seen.add(entry[0]);
    return true;
  });
};

export const militaryAiSaveError = (
  movement: unknown,
  commander: unknown,
  soldierIds: ReadonlySet<number>
) => {
  const maximum = Math.max(1, soldierIds.size),
    uid = (value: unknown) => integer(value) && soldierIds.has(value);
  if (movement !== undefined) {
    if (
      !isSaveObject(movement) ||
      !finite(movement.clock) ||
      movement.clock < 0 ||
      !integer(movement.nextGroup) ||
      movement.nextGroup < 1 ||
      !integer(movement.handovers)
    )
      return "Invalid military movement clock";
    const grouped = new Set<number>(),
      groups = new Set<number>();
    if (
      !array(movement.groups, maximum, (group) => {
        if (
          !isSaveObject(group) ||
          !integer(group.id) ||
          group.id < 1 ||
          groups.has(group.id) ||
          group.id >= Number(movement.nextGroup) ||
          !integer(group.faction) ||
          !point(group.destination) ||
          !isSaveObject(group.bounds) ||
          ![group.bounds.minX, group.bounds.minZ].every(integer) ||
          ![group.bounds.width, group.bounds.height].every(
            (n) => integer(n) && n > 0 && n <= MAP_SIDE_RANGE.max
          ) ||
          Number(group.bounds.minX) + Number(group.bounds.width) > MAP_SIDE_RANGE.max ||
          Number(group.bounds.minZ) + Number(group.bounds.height) > MAP_SIDE_RANGE.max
        )
          return false;
        groups.add(group.id);
        const members = new Set<number>();
        if (
          !array(group.members, maximum, (member) => {
            if (
              !isSaveObject(member) ||
              !uid(member.uid) ||
              grouped.has(Number(member.uid)) ||
              !point(member.start)
            )
              return false;
            grouped.add(Number(member.uid));
            members.add(Number(member.uid));
            return true;
          }) ||
          !members.size
        )
          return false;
        return true;
      }) ||
      !pairs(
        movement.owners,
        maximum,
        uid,
        // "slot" was a formation owner before FUTURE-07; it loads as its own path.
        (owner) => typeof owner === "string" && ["path", "flow", "slot"].includes(owner)
      ) ||
      !pairs(movement.flowRetry, maximum, uid, finite) ||
      !pairs(
        movement.stillWatch,
        maximum,
        uid,
        (watch) => point(watch) && isSaveObject(watch) && finite(watch.since)
      )
    )
      return "Invalid military movement groups or owners";
  }
  if (commander !== undefined) {
    if (
      !isSaveObject(commander) ||
      !pairs(
        commander.clocks,
        10000,
        integer,
        (clock) => finite(clock) && clock >= 0 && clock <= MAX_DECISION_INTERVAL
      ) ||
      !pairs(commander.retreating, 10000, integer, (time) => finite(time) && time >= 0) ||
      (commander.cursors !== undefined && !pairs(commander.cursors, 10000, integer, integer)) ||
      !pairs(commander.memories, 10000, integer, (memory) =>
        pairs(
          memory,
          10000,
          integer,
          (item) =>
            isSaveObject(item) &&
            action(item.action) &&
            (item.target === undefined || point(item.target)) &&
            roleGroups(item.groups)
        )
      ) ||
      !isSaveObject(commander.objectives) ||
      !pairs(
        commander.objectives.objectives,
        10000,
        integer,
        (item) =>
          point(item) && isSaveObject(item) && order(item.order) && typeof item.diverted === "boolean"
      ) ||
      !pairs(
        commander.objectives.led,
        10000,
        integer,
        (value) => typeof value === "boolean"
      )
    )
      return "Invalid military commander memory";
  }
  return null;
};
