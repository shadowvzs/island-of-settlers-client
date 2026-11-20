import { describe, expect, it } from "vitest";

import { findUnscopedReads } from "../tools/webgpu/tsl-scope";

describe("TSL scope check (P33)", () => {
  it("flags a variable first assigned inside an if and read after it", () => {
    const source = `void main() {
\tif ( ( nodeUniform1 > 0.5 ) ) {
\t\tnodeVar1 = normalize( nodeUniform2 );
\t\tnodeVar2 = nodeVar1.y;
\t}
\tnodeVar3 = dot( nodeVar0, nodeVar1 );
}`;
    expect(findUnscopedReads(source).map(read => read.variable)).toEqual(["nodeVar0", "nodeVar1"]);
  });

  it("accepts assignments in both arms of an if/else and in enclosing blocks", () => {
    const source = `void main() {
\tnodeVar1 = 1.0;
\tif ( ( nodeVar1 > 0.0 ) ) {
\t\tnodeVar2 = 0.26;
\t} else {
\t\tnodeVar2 = 0.44;
\t}
\tnodeVar3 = ( nodeVar1 / nodeVar2 );
}`;
    expect(findUnscopedReads(source)).toEqual([]);
  });
});
