import type { Stage, StageGroup } from "../lib/stages";

/** Pipeline-ordered stage tabs over the case's artifacts (ui.md §5.3). */
export function StageTabs({
  groups,
  active,
  onSelect,
}: {
  groups: StageGroup[];
  active: Stage;
  onSelect: (stage: Stage) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-surface-overlay px-4 pt-2">
      {groups.map((group) => (
        <button
          key={group.stage}
          type="button"
          role="tab"
          aria-selected={group.stage === active}
          onClick={() => onSelect(group.stage)}
          className={`rounded-t border-b-2 px-3 py-1.5 text-sm ${
            group.stage === active
              ? "border-brand text-ink-primary"
              : "border-transparent text-ink-subtle hover:text-ink-secondary"
          }`}
        >
          {group.stage}
        </button>
      ))}
    </div>
  );
}
