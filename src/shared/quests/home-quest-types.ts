/** The minimal code-side view of a tutorial quest: the book is the only definition after QU8. */
export type TutorialResource = "coal" | "fish" | "gold" | "iron" | "ore" | "rock" | "wildlife";

export type TutorialObjective =
  | { kind: "build"; building: number; amount: number }
  | { kind: "produce"; ware: string; amount: number }
  | { kind: "event"; event: string; amount: number; countsBeforeUnlock?: boolean }
  | { kind: "stock"; ware: string; amount: number; building: number }
  | { kind: "deliver"; ware: string; amount: number }
  | { kind: "garrison"; amount: number; troop?: string };

export interface TutorialQuest {
  id: string;
  /** The chapter, numbered by the player level that opens it. */
  chapter: number;
  experience: number;
  objective: TutorialObjective;
  optional?: boolean;
  resource?: TutorialResource;
}
