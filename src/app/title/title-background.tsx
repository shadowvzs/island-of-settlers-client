import type { TitleBackground } from "./title-media";

interface TitleBackgroundViewProps {
  background: TitleBackground;
}
/** The deployer's title background over the painted scene: a muted looping video, or a still image. */
export const TitleBackgroundView = ({ background }: TitleBackgroundViewProps) => {
  if (background.kind === "video")
    return <video autoPlay className="title-page__background" loop muted playsInline src={background.url} />;
  return <img alt="" className="title-page__background" draggable={false} src={background.url} />;
};
