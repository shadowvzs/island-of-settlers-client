import { readFileSync, writeFileSync } from "node:fs";

import { convertSaveToV4 } from "./save-v4-conversion";

/**
 * One-off converter of version 3 saves to version 4 (research 12, S04; owner D-S10: test fixtures
 * are converted copies, the retained receipts stay untouched).
 * Usage: npx tsx tools/analysis/convert-save-fixture-v4.ts <input.json> <output.json>
 */
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: npx tsx tools/analysis/convert-save-fixture-v4.ts <in.json> <out.json>");
const converted = convertSaveToV4(JSON.parse(readFileSync(input, "utf8")));
writeFileSync(output, JSON.stringify(converted));
console.log(`${input} -> ${output}`);
