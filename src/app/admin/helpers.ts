/** The present entries of a list with optional ones (`condition && item`), in order. */
export const presentItems = <T>(items: readonly (T | false | null | undefined)[]): T[] =>
  items.filter((item): item is T => Boolean(item));

/** A thrown value's message for a status line. */
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** A wrong typed confirmation sends nothing: the typed text must equal the expected text exactly. */
export const confirmationMatches = (typed: string, expected: string | null) => expected === null || typed === expected;
