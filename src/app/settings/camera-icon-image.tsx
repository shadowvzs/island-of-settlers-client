interface CameraIconImageProps {
  source: string;
}
/** A decorative 36 px rendered camera icon (the button carries the name). */
export const CameraIconImage = ({ source }: CameraIconImageProps) => (
  <img alt="" className="camera-control-icon" draggable={false} height={36} src={source} width={36} />
);
