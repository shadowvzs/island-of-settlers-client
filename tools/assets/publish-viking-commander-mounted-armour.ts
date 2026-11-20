import assert from "node:assert/strict";
import { resolve } from "node:path";

import { inspectVikingCommanderMountedArmour, publishVikingCommanderMountedArmour,
  syncVikingCommanderMountedArmour } from "./viking-commander-mounted-armour";

const args = process.argv.slice(2);
if (args.includes("--check")) {
  assert.equal(args.length, 1);
  console.log(JSON.stringify(await syncVikingCommanderMountedArmour({ checkOnly: true }), null, 2));
} else {
  const candidate = args.find(arg => !arg.startsWith("--"));
  assert(candidate, "Provide the frozen root-reviewed candidate path");
  assert(args.every(arg => arg === candidate || arg === "--publish"));
  const file = resolve(candidate);
  const receipt = args.includes("--publish")
    ? await publishVikingCommanderMountedArmour(file) : await inspectVikingCommanderMountedArmour(file);
  console.log(JSON.stringify({ published: args.includes("--publish"), ...receipt }, null, 2));
}
