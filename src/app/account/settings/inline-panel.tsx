import type { ReactNode } from "react";

interface InlinePanelProps {
  children: ReactNode;
  id: string;
  question: string;
}
/** An inline group (no browser dialog) with a question, opened in place under the account buttons. */
export const InlinePanel = ({ children, id, question }: InlinePanelProps) => (
  <div aria-labelledby={id} className="account-settings__panel" role="group">
    <p className="account-settings__question" id={id}>{question}</p>
    {children}
  </div>
);
