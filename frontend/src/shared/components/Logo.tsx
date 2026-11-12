/** The console mark: an ink tile with a document and an ember check — "credit file, verified". */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg className="cu-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <path d="M10 7.5h8l4 4V24a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5z" fill="none" stroke="var(--on-ink)"
        strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18 7.5v4h4" fill="none" stroke="var(--on-ink)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12.8 17.6l2.4 2.4 4.4-4.6" fill="none" stroke="var(--accent)" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
