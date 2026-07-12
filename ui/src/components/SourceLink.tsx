/**
 * The dotted provenance jump under a model-derived line — the one visual
 * vocabulary for "this has a source; open it". Every screen that shows
 * generated content renders this next to it (provenance is the product's
 * differentiator, ui.md §2): the brief's key facts, the theatre timeline,
 * the gap-analysis questions, the anticipated issues.
 */
export function SourceLink({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid="source-link"
      onClick={onClick}
      className={`text-[12.5px] font-semibold text-brand-ink underline decoration-dotted underline-offset-[3px] ${className}`}
    >
      {children}
    </button>
  );
}
