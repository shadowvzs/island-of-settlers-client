import { TRIPO_ROSTER } from "@workers/tripo-roster";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listFallbackBodies,
  loadWorkerBody
} from "../src/render-common/workers/worker-appearance";

const [missing, present] = TRIPO_ROSTER.roman.female;
const appearance = { nation: "roman", variant: missing! } as const;

describe("worker body fallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tries the nation's other bodies, same gender first", () => {
    const bodies = listFallbackBodies(appearance);
    expect(bodies).not.toContain(missing);
    expect(bodies.slice(0, TRIPO_ROSTER.roman.female.length - 1)).toEqual(
      TRIPO_ROSTER.roman.female.filter((id) => id !== missing)
    );
    expect(bodies).toEqual(expect.arrayContaining([...TRIPO_ROSTER.roman.male]));
  });

  it("skips a body whose files fail and loads another one with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const load = vi.fn(async (body: { variant: string }) => {
      if (body.variant === missing) throw new SyntaxError("JSON.parse: unexpected character");
      return body.variant;
    });
    expect(await loadWorkerBody(appearance, load)).toBe(present);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("fails only when no body of the nation loads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const load = () => Promise.reject(new Error("404"));
    await expect(loadWorkerBody(appearance, load)).rejects.toThrow(/No roman worker body/);
  });
});
