import { describe, expect, it } from "vitest";

import { nextMusicTrackAfterEnd } from "../src/app/audio/music-playlist";

describe("music playlist completion policy", () => {
  it("advances through remaining tracks even with playlist repeat off", () => {
    expect(nextMusicTrackAfterEnd(0, 3, false, false)).toBe(1);
    expect(nextMusicTrackAfterEnd(1, 3, false, true)).toBe(2);
  });
  it("stops at the last track unless playlist repeat is enabled", () => {
    expect(nextMusicTrackAfterEnd(2, 3, false, false)).toBeNull();
    expect(nextMusicTrackAfterEnd(2, 3, false, true)).toBe(0);
  });
  it("gives looping the current track precedence over playlist repeat", () => {
    expect(nextMusicTrackAfterEnd(1, 3, true, true)).toBe(1);
    expect(nextMusicTrackAfterEnd(2, 3, true, false)).toBe(2);
  });
  it("handles a single-track local queue without inventing another entry", () => {
    expect(nextMusicTrackAfterEnd(0, 1, false, false)).toBeNull();
    expect(nextMusicTrackAfterEnd(0, 1, false, true)).toBe(0);
    expect(nextMusicTrackAfterEnd(0, 1, true, false)).toBe(0);
  });
  it("does not advance an empty queue or a stale selection", () => {
    expect(nextMusicTrackAfterEnd(0, 0, true, true)).toBeNull();
    expect(nextMusicTrackAfterEnd(3, 3, false, true)).toBeNull();
    expect(nextMusicTrackAfterEnd(-1, 3, false, true)).toBeNull();
  });
});
