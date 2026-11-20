import { useLingui } from "@lingui/react";

import { DevelopmentToolButton } from "./development-tool-button";
import type { DevelopmentTool } from "./helpers";
import { resolveDevelopmentText } from "./messages";

interface DevelopmentToolGridProps {
  tools: readonly DevelopmentTool[];
}
/** The grid of development tool icons, each captioned by its accessible name. */
export const DevelopmentToolGrid = ({ tools }: DevelopmentToolGridProps) => {
  const { i18n } = useLingui();
  return (
    <div className="development-menu__items">
      {tools.map(tool => {
        const label = resolveDevelopmentText(i18n, tool.label);
        return (
          <div className="development-menu__item" key={label}>
            <DevelopmentToolButton tool={tool} />
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
};
