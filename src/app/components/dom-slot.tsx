import { type AriaRole, useLayoutEffect, useRef } from "react";

interface DomSlotProps {
  className?: string;
  label?: string;
  nodes: readonly Node[];
  role?: AriaRole;
}
/**
 * Hosts existing DOM nodes (window launchers, not yet migrated sub-panels) inside React markup. React
 * renders no children here, so it never competes with the nodes' own code.
 */
export const DomSlot = ({ className, label, nodes, role }: DomSlotProps) => {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    host.current!.replaceChildren(...nodes);
  }, [nodes]);
  return <div aria-label={label} className={className} ref={host} role={role} />;
};
