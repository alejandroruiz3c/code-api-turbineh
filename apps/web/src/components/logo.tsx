import { MARK_PATHS, WORDMARK_PATHS } from "./logo-paths";

export function Logo({
  className,
  withWordmark = true,
}: {
  className?: string;
  withWordmark?: boolean;
}) {
  const paths = withWordmark ? [...MARK_PATHS, ...WORDMARK_PATHS] : MARK_PATHS;
  return (
    <svg
      viewBox={withWordmark ? "640 560 4560 2420" : "640 560 2340 2420"}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
