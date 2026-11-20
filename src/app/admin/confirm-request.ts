/**
 * One confirmation of an administrator action (Maintenance M1–M12, Users M4): what it does, the text to type
 * (null = a plain confirmation), an optional extra choice and the work itself, which answers the status line.
 */
export interface ConfirmRequest {
  confirmLabel: string;
  /** The text the administrator must type exactly; null = no typing. */
  expected: string | null;
  lines: string[];
  /** The label of an extra checkbox (M4: also the wallet); null = none. */
  option: string | null;
  title: string;
  run(option: boolean): Promise<string>;
}
