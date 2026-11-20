import type { ReactNode } from "react";

import { joinClassNames } from "../../components/helpers";
import { useCampaignImage } from "./use-campaign-image";

import "./campaign-image.css";

interface CampaignImageProps {
  /** Fallback content shown while the image is absent or failed to load. */
  children: ReactNode;
  className?: string;
  source: string | null;
}
/**
 * A campaign story image or portrait (WebP from the campaign repository) in a fixed frame: the frame keeps its
 * size, so a late image never shifts the layout. The image loads lazily and decodes off the main thread.
 */
export const CampaignImage = ({ children, className, source }: CampaignImageProps) => {
  const { imageSource, onError } = useCampaignImage(source);
  return (
    <div className={joinClassNames("campaign-image", className)}>
      {imageSource && (
        <img alt="" decoding="async" draggable={false} key={imageSource} loading="lazy" src={imageSource}
          onError={onError} />
      )}
      {!imageSource && <div aria-hidden="true" className="campaign-image__fallback">{children}</div>}
    </div>
  );
};
