interface ProgressBarProps {
  className?: string;
  label?: string;
  max: number;
  title?: string;
  value: number;
  /** Spoken value (e.g. "Baking: 42%") instead of the bare percentage. */
  valueText?: string;
}
/** Native `<progress>`; `max` is at least 1 so an empty plan never reads as complete. */
export const ProgressBar = ({ className, label, max, title, value, valueText }: ProgressBarProps) => (
  <progress
    aria-label={label}
    aria-valuetext={valueText}
    className={className}
    max={Math.max(1, max)}
    title={title}
    value={value}
  />
);
