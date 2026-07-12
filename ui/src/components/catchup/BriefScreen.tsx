/**
 * The patient view (PeriOp Catch-Up.dc.html "BRIEF"). Pre-op reads as key
 * facts with the story so far in the rail, above the sign-off (v2-ui
 * feedback). In theatre the brief reads as three columns — key facts ·
 * theatre timeline · anticipated issues — over one action bar (v2-ui
 * feedback: no "story so far" or "needs you now" after pre-op; the open
 * questions were already reviewed at the interview gate). The recovery
 * brief shows the post-op run's own two writers side by side — the PACU
 * handoff and the post-anaesthesia evaluation — not the intra-op era's
 * columns again (v2-ui feedback). The one forward action adapts to the
 * case's stage (sign off / acknowledge / continue).
 */
import { useState } from "react";
import { CaseSheet } from "../CaseSheet";
import type { BriefModel, ChainNode } from "../../lib/catchup";
import type { PrimaryAction } from "../../lib/workflow";
import type { SourceRequest } from "./SourceModal";

interface QueueNav {
  pos: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export function BriefScreen({
  model,
  queue,
  canReview,
  onBack,
  onOpenSource,
  onAction,
  canViewStage = () => false,
  onSelectStage,
  generating = null,
  onEditClaim,
  onAddClaim,
}: {
  model: BriefModel;
  queue: QueueNav | null;
  canReview: boolean;
  onBack: () => void;
  onOpenSource: (req: SourceRequest) => void;
  /** the pre-op sign-off also carries `opts.equipment`: the recommended
   * items the provider ticked, reserved as the stage completes */
  onAction: (action: PrimaryAction, opts?: { equipment?: string[] }) => void;
  /** which stages' output can be visited via the stepper bubbles —
   * any stage whose primary artifact exists */
  canViewStage?: (stage: BriefModel["stage"]) => boolean;
  onSelectStage?: (stage: BriefModel["stage"]) => void;
  /** non-null while this session's own stage run is streaming — the brief
   * has no FlowChrome to fold the live status into, so it shows minimally
   * in the action panel instead of taking over the screen */
  generating?: string | null;
  /** provider corrections before sign-off (v2-ui feedback): rewrite one of
   * an artifact's claims / add a provider-asserted fact to it. Both land as
   * human-attested edits on the case record; omitted = read-only. */
  onEditClaim?: (artifactId: string, claimId: string, text: string) => void;
  onAddClaim?: (artifactId: string, text: string) => void;
}) {
  const first = model.title.split(" ")[0] || "this patient";

  // the pre-op equipment recommendations: unticked by default — ticking is
  // the provider's explicit choice to reserve at sign-off
  const [tickedEquipment, setTickedEquipment] = useState<Set<string>>(new Set());
  const showEquipment =
    model.stage === "preop" && !model.viewingPast && model.equipmentSuggestions.length > 0;

  function toggleEquipment(itemId: string) {
    setTickedEquipment((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  /** Forward an action; a pre-op sign-off rides the ticked equipment along. */
  function act(action: PrimaryAction) {
    onAction(
      action,
      action.kind === "sign-off" && showEquipment
        ? { equipment: [...tickedEquipment] }
        : undefined,
    );
  }

  // where provider edits land while the shown stage is still live: the
  // story so far edits the pre-op note; the issues column edits the
  // anticipated-issues note. Sign-off freezes both (the stage moves on).
  const canEdit = canReview && !model.viewingPast && !!onEditClaim && !!onAddClaim;
  const storyTarget =
    canEdit && model.stage === "preop" ? model.keyFactsSource : null;
  const issuesTarget =
    canEdit && model.stage === "intraop" ? model.issuesArtifact : null;

  // the one forward action — a bar under the columns (intra-op and post-op)
  const actionBar = (
    <div className="flex-none border-t border-surface-chromeline bg-surface-sunken px-8 py-4">
      <div className="ml-auto w-[400px] max-w-full rounded-[15px] border border-surface-overlay bg-surface-base p-4">
        <ActionPanel
          model={model}
          canReview={canReview}
          generating={generating}
          first={first}
          onAction={act}
        />
      </div>
    </div>
  );

  return (
    <CaseSheet onBack={onBack}>
      {/* header — going back to the worklist is the gutter, not a button */}
      <div className="flex-none border-b border-surface-chromeline bg-surface-chrome px-8 pb-4 pt-5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            {queue && queue.total > 1 && (
              <div className="mb-2 flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Previous case"
                  onClick={queue.onPrev}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-surface-overlay bg-surface-sunken text-[15px] text-ink-secondary"
                >
                  ‹
                </button>
                <span className="whitespace-nowrap px-2.5 text-[12px] text-ink-subtle">
                  Waiting for you · {queue.pos} of {queue.total}
                </span>
                <button
                  type="button"
                  aria-label="Next case"
                  onClick={queue.onNext}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-surface-overlay bg-surface-sunken text-[15px] text-ink-secondary"
                >
                  ›
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3.5">
              <span className="font-serif text-[32px] font-medium leading-none text-ink-primary">
                {model.title}
              </span>
              <span
                className={`rounded-full border border-brand/28 px-3 py-1.5 text-[13px] font-semibold ${model.stageDisplay.className}`}
              >
                {model.stageDisplay.long}
              </span>
            </div>
            <div className="mt-1.5 text-[14.5px] text-ink-muted">
              Case {model.caseId}
              {model.writable ? "" : " · review only"}
            </div>
          </div>
          <ProviderChain chain={model.chain} />
        </div>
        <StageStepper
          steps={model.stageSteps}
          shown={model.stage}
          canView={canViewStage}
          onSelect={onSelectStage}
        />
      </div>

      {/* body — pre-op keeps the narrative page; in theatre and recovery
          read as three columns over one action bar */}
      {model.stage === "preop" ? (
        <div className="flex min-h-0 flex-1">
          {/* main column */}
          <div className="min-w-0 flex-1 overflow-y-auto px-8 pb-12 pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <Eyebrow>Key facts</Eyebrow>
              <div className="text-[12.5px] text-ink-faint">Open a source for the original</div>
            </div>
            <div className="mb-9 mt-1.5">
              <KeyFactsList facts={model.keyFacts} onOpenSource={onOpenSource} />
            </div>
          </div>

          {/* right rail: the story so far over the one forward action — the
              open questions were already reviewed at the interview gate */}
          <div className="flex w-[410px] flex-none flex-col border-l border-surface-chromeline bg-surface-sunken">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-6">
              <Eyebrow>The story so far</Eyebrow>
              <div className="mt-0.5 text-[12.5px] text-ink-faint">{model.assembledFrom}</div>
              {model.attentionCount > 0 && (
                <div className="mt-3">
                  <p className="font-serif text-[17px] leading-relaxed text-ink-body">
                    {model.attentionCount === 1
                      ? "One thing is worth your attention"
                      : `${model.attentionCount} things are worth your attention`}{" "}
                    before you take over {first}:
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {model.attentionItems.map((it, i) => (
                      <li key={i} className="flex gap-2.5 text-[14.5px] leading-relaxed text-ink-body">
                        <span className="flex-none text-gold">◆</span>
                        {storyTarget && it.claimId ? (
                          <EditableLine
                            text={it.text}
                            onSave={(t) => onEditClaim!(storyTarget, it.claimId!, t)}
                          />
                        ) : (
                          <span>{it.text}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {storyTarget && (
                <AddLine
                  placeholder="Add to the story so far…"
                  onAdd={(t) => onAddClaim!(storyTarget, t)}
                />
              )}
            </div>
            <div className="flex-none border-t border-surface-overlay bg-surface-sunken px-6 pb-5 pt-4">
              {showEquipment && (
                <EquipmentChecklist
                  suggestions={model.equipmentSuggestions}
                  ticked={tickedEquipment}
                  onToggle={toggleEquipment}
                  disabled={!canReview}
                />
              )}
              <div className="rounded-[15px] border border-surface-overlay bg-surface-base p-4">
                <ActionPanel
                  model={model}
                  canReview={canReview}
                  generating={generating}
                  first={first}
                  onAction={act}
                />
              </div>
            </div>
          </div>
        </div>
      ) : model.stage === "postop" ? (
        <>
          {/* recovery: the post-op run's own two writers, side by side */}
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-10 pt-6">
              <div className="flex items-baseline justify-between gap-4">
                <Eyebrow>
                  {model.keyFactsSource === "note:pacu-handoff" ? "PACU handoff" : "Key facts"}
                </Eyebrow>
                <div className="text-[12.5px] text-ink-faint">Open a source for the original</div>
              </div>
              <div className="mt-1.5">
                <KeyFactsList facts={model.keyFacts} onOpenSource={onOpenSource} />
              </div>
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto border-l border-surface-chromeline px-6 pb-10 pt-6">
              <Eyebrow>Post-anaesthesia evaluation</Eyebrow>
              {model.postopEval.length > 0 ? (
                <div className="mt-1.5">
                  <KeyFactsList facts={model.postopEval} onOpenSource={onOpenSource} />
                </div>
              ) : (
                <SectionPlaceholder>
                  The post-anaesthesia evaluation appears once the post-op interview is
                  generated.
                </SectionPlaceholder>
              )}
            </div>
          </div>
          {actionBar}
        </>
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-10 pt-6">
              <div className="flex items-baseline justify-between gap-4">
                <Eyebrow>Key facts</Eyebrow>
                <div className="text-[12.5px] text-ink-faint">Open a source for the original</div>
              </div>
              <div className="mt-1.5">
                <KeyFactsList facts={model.keyFacts} onOpenSource={onOpenSource} />
              </div>
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto border-l border-surface-chromeline px-6 pb-10 pt-6">
              <Eyebrow>
                In theatre{model.intraopPerformer ? ` · ${model.intraopPerformer}` : ""}
              </Eyebrow>
              <TheatreTimeline model={model} onOpenSource={onOpenSource} />
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto border-l border-surface-chromeline px-6 pb-10 pt-6">
              <Eyebrow>Anticipated issues</Eyebrow>
              <IssuesList
                model={model}
                editTarget={issuesTarget}
                onEditClaim={onEditClaim}
                onAddClaim={onAddClaim}
              />
            </div>
          </div>
          {actionBar}
        </>
      )}
    </CaseSheet>
  );
}

/** The key-facts rows — each with its verification badge and source jump. */
function KeyFactsList({
  facts,
  onOpenSource,
}: {
  facts: BriefModel["keyFacts"];
  onOpenSource: (req: SourceRequest) => void;
}) {
  return (
    <>
      {facts.map((f) => (
        <div key={f.claimId} className="border-t border-surface-line px-3 py-3.5">
          <div className="flex items-baseline justify-between gap-5">
            <span className="flex-1 text-[16.5px] leading-snug text-ink-primary">{f.text}</span>
            <span className="flex flex-none items-center gap-2">
              {f.showStatus && (
                <span className={`text-[12px] font-semibold ${f.statusMeta.className}`}>
                  {f.statusMeta.label}
                </span>
              )}
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${f.statusMeta.dotClassName} ${f.statusMeta.className}`}
              >
                {f.statusMeta.glyph}
              </span>
            </span>
          </div>
          <div className="mt-2 flex justify-end">
            {f.hasProv ? (
              <SourceLink onClick={() => onOpenSource({ title: f.text, refs: f.refs })}>
                {f.provLabel}
              </SourceLink>
            ) : (
              <span className="text-[12.5px] text-ink-ghost">Awaiting a source</span>
            )}
          </div>
        </div>
      ))}
      {facts.length === 0 && (
        <p className="border-t border-surface-line py-6 text-[14px] text-ink-subtle">
          No facts have been extracted for this case yet.
        </p>
      )}
    </>
  );
}

function TheatreTimeline({
  model,
  onOpenSource,
}: {
  model: BriefModel;
  onOpenSource: (req: SourceRequest) => void;
}) {
  if (model.events.length === 0) {
    return (
      <SectionPlaceholder>
        {model.reachedTheatre
          ? "No dictation was recorded for the theatre record."
          : "Not in the operating room yet — the theatre timeline fills in live once the case reaches theatre."}
      </SectionPlaceholder>
    );
  }
  return (
    <div className="mt-3.5">
      {model.events.map((e, i) => (
        <div key={i} className="flex gap-4">
          <div className="w-[52px] flex-none pt-px text-right text-[13.5px] font-semibold text-ink-muted">
            {e.t}
          </div>
          <div className="flex flex-none flex-col items-center">
            <span className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full border-2 border-gold-soft bg-surface-base" />
            {i < model.events.length - 1 && (
              <span className="my-0.5 w-0.5 flex-1 bg-surface-overlay" />
            )}
          </div>
          <div className="min-w-0 flex-1 pb-[18px]">
            <div className="text-[15.5px] leading-snug text-ink-primary">{e.text}</div>
            {e.hasProv && (
              <SourceLink
                className="mt-1.5"
                onClick={() => onOpenSource({ title: e.text, refs: e.refs })}
              >
                Play the dictation
              </SourceLink>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function IssuesList({
  model,
  editTarget = null,
  onEditClaim,
  onAddClaim,
}: {
  model: BriefModel;
  /** the anticipated-issues artifact id while its stage is live — enables
   * provider edits and additions on the list */
  editTarget?: string | null;
  onEditClaim?: (artifactId: string, claimId: string, text: string) => void;
  onAddClaim?: (artifactId: string, text: string) => void;
}) {
  return (
    <>
      {model.issues.length === 0 ? (
        <SectionPlaceholder>
          {model.reachedTheatre
            ? "No post-op issues were anticipated for this case."
            : "Anticipated post-op issues appear once the theatre record is generated."}
        </SectionPlaceholder>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {model.issues.map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-[11px] border border-surface-overlay bg-surface-warm px-4 py-3.5"
            >
              <span className="flex-none text-[13px] leading-relaxed text-gold">◆</span>
              {editTarget && r.claimId ? (
                <EditableLine
                  className="text-[15px] leading-relaxed text-ink-body"
                  text={r.text}
                  onSave={(t) => onEditClaim!(editTarget, r.claimId!, t)}
                />
              ) : (
                <span className="text-[15px] leading-relaxed text-ink-body">{r.text}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {editTarget && (
        <AddLine
          placeholder="Add an anticipated issue…"
          onAdd={(t) => onAddClaim!(editTarget, t)}
        />
      )}
    </>
  );
}

/** One provider-editable list line: text with a pencil that swaps to an
 * inline textarea; saving hands the trimmed text back. */
function EditableLine({
  text,
  onSave,
  className = "",
}: {
  text: string;
  onSave: (text: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  if (!editing) {
    return (
      <span className="flex min-w-0 flex-1 items-start justify-between gap-2">
        <span className={className}>{text}</span>
        <button
          type="button"
          aria-label={`Edit: ${text}`}
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
          className="flex-none rounded px-1 text-[13px] text-ink-faint hover:text-ink-primary"
        >
          ✎
        </button>
      </span>
    );
  }
  return (
    <span className="min-w-0 flex-1">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={`Edit: ${text}`}
        className="min-h-[64px] w-full rounded-[9px] border border-surface-overlay bg-surface-base px-2.5 py-2 text-[13.5px] leading-relaxed text-ink-primary outline-none focus:border-brand"
      />
      <span className="mt-1.5 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-[8px] px-2.5 py-1 text-[12.5px] font-semibold text-ink-dim"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={() => {
            onSave(draft.trim());
            setEditing(false);
          }}
          className="rounded-[8px] bg-brand px-3 py-1 text-[12.5px] font-semibold text-ink-onBrand disabled:opacity-40"
        >
          Save
        </button>
      </span>
    </span>
  );
}

/** The add-your-own input under a provider-editable list. */
function AddLine({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  }

  return (
    <div className="mt-3 flex gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-[9px] border border-surface-overlay bg-surface-base px-2.5 py-2 text-[13px] text-ink-primary outline-none placeholder:text-ink-ghost focus:border-brand"
      />
      <button
        type="button"
        disabled={!draft.trim()}
        onClick={submit}
        className="flex-none rounded-[9px] border border-surface-overlay bg-surface-base px-3 py-1.5 text-[12.5px] font-semibold text-ink-muted disabled:opacity-40"
      >
        + Add
      </button>
    </div>
  );
}

/** The pre-op run's recommended equipment as tickboxes over the sign-off
 * action: ticked items are reserved for the case when pre-op completes.
 * Unticked by default — reserving is the provider's call, not the model's. */
function EquipmentChecklist({
  suggestions,
  ticked,
  onToggle,
  disabled,
}: {
  suggestions: BriefModel["equipmentSuggestions"];
  ticked: Set<string>;
  onToggle: (itemId: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mb-3 rounded-[15px] border border-surface-overlay bg-surface-base p-4">
      <Eyebrow>Recommended equipment</Eyebrow>
      <div className="mt-0.5 text-[12.5px] text-ink-faint">
        Ticked items are reserved for this case when you complete pre-op
      </div>
      <ul className="mt-2.5 space-y-2">
        {suggestions.map((s) => (
          <li key={s.item_id}>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={ticked.has(s.item_id)}
                onChange={() => onToggle(s.item_id)}
                disabled={disabled}
                className="mt-1 h-4 w-4 flex-none accent-brand"
              />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-ink-primary">
                  {s.name}
                </span>
                <span className="block text-[12.5px] leading-relaxed text-ink-muted">
                  {s.reason}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact Pre-op › Intra-op › Post-op progress, mirroring FlowChrome's
 * stepper — the brief has its own header and never rendered inside
 * FlowChrome, so without this the stage progress disappeared entirely
 * once a case left the capture flow. Bubbles for completed stages are
 * buttons: they pin the brief to that stage's output. */
function StageStepper({
  steps,
  shown,
  canView,
  onSelect,
}: {
  steps: BriefModel["stageSteps"];
  /** the stage the brief is showing right now */
  shown: BriefModel["stage"];
  canView: (stage: BriefModel["stage"]) => boolean;
  onSelect?: (stage: BriefModel["stage"]) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-1.5">
      {steps.map((s, i) => {
        const done = s.state === "done";
        const current = s.state === "current";
        const clickable = !!onSelect && s.key !== shown && canView(s.key);
        const pill = (
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
              current
                ? "bg-brand text-ink-onBrand"
                : done
                  ? "text-status-supported"
                  : "text-ink-faint"
            }`}
          >
            <span
              className={`flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full text-[9px] font-bold ${
                done
                  ? "bg-status-supported/20 text-status-supported"
                  : current
                    ? "bg-white/20 text-ink-onBrand"
                    : "border border-surface-overlay text-ink-faint"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            {s.label}
          </span>
        );
        return (
          <div key={s.key} className="flex items-center">
            {i > 0 && <div className="mx-1.5 h-px w-5 bg-surface-overlay" />}
            {clickable ? (
              <button
                type="button"
                onClick={() => onSelect(s.key)}
                className="rounded-full hover:bg-surface-panel"
              >
                {pill}
              </button>
            ) : (
              pill
            )}
          </div>
        );
      })}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px] font-bold uppercase tracking-[.12em] text-gold">{children}</div>
  );
}

/** A calm stand-in for a section a stage hasn't reached yet — keeps the page
 * skeleton identical across pre-op, in-theatre, recovery and complete. */
function SectionPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-9 mt-3 max-w-[760px] rounded-[11px] border border-dashed border-surface-overlay px-4 py-4 text-[13.5px] leading-relaxed text-ink-subtle">
      {children}
    </div>
  );
}

const STAGE_NOUN: Record<BriefModel["stage"], string> = {
  preop: "pre-op assessment",
  intraop: "theatre record",
  postop: "recovery handoff",
};

/**
 * The single forward action in the rail, resolved from the case's stage. In the
 * patient view this is realistically sign-off (pre-op / in-theatre),
 * acknowledge (recovery), or a nudge back to intake to finish capture — with a
 * confirmed / read-only / complete resting state.
 */
function ActionPanel({
  model,
  canReview,
  generating,
  first,
  onAction,
}: {
  model: BriefModel;
  canReview: boolean;
  generating: string | null;
  first: string;
  onAction: (action: PrimaryAction) => void;
}) {
  // this session's own run in flight — checked before anything else so it
  // pre-empts the resting/action states below while it streams
  if (generating !== null) {
    return (
      <div className="flex items-center gap-3 text-[13.5px] text-ink-secondary">
        <span
          className="h-4 w-4 flex-none rounded-full border-[2.5px] border-transparent border-t-brand"
          style={{ animation: "spin .8s linear infinite" }}
        />
        {generating || "The pipeline is building this case — you can leave and come back."}
      </div>
    );
  }

  // pinned to a completed stage via the stepper bubbles — the record is
  // being read, so the case's forward action is withheld here
  if (model.viewingPast) {
    return (
      <div className="text-[13.5px] leading-relaxed text-ink-secondary">
        You're viewing this completed stage's output. Use the stage bubbles above
        to return to where the case is now.
      </div>
    );
  }

  // resting states first
  if (model.acknowledgedBy) {
    return (
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand text-[18px] text-ink-onBrand">
          ✓
        </span>
        <div>
          <div className="text-[15px] font-semibold text-brand-ink">You now hold this patient.</div>
          {model.acknowledgedMeta && (
            <div className="mt-px text-[12.5px] text-ink-secondary">
              Handoff acknowledged {model.acknowledgedMeta}
            </div>
          )}
        </div>
      </div>
    );
  }

  const action = model.action;

  if (!canReview || !action) {
    return (
      <div className="text-[13.5px] leading-relaxed text-ink-secondary">
        {!model.writable
          ? "This case is read-only — a reference record. Nothing to sign off here."
          : !action
            ? "Signed off — this case is complete."
            : "Pick a provider (top right) to act on this case."}
      </div>
    );
  }

  const noun = STAGE_NOUN[model.stage];
  const pending =
    model.pendingReview > 0 ? (
      <div className="mt-2.5 flex items-center gap-2 text-[12.5px] text-status-conflicting">
        <span>›</span>
        {model.pendingReview} item{model.pendingReview === 1 ? "" : "s"} still need your review — you
        can still continue.
      </div>
    ) : null;

  if (action.kind === "generating") {
    return (
      <div className="flex items-center gap-3 text-[13.5px] text-ink-secondary">
        <span
          className="h-4 w-4 flex-none rounded-full border-[2.5px] border-transparent border-t-brand"
          style={{ animation: "spin .8s linear infinite" }}
        />
        The pipeline is building this case — you can leave and come back.
      </div>
    );
  }

  // copy per action kind
  let lead: React.ReactNode;
  let cta = action.label;
  if (action.kind === "acknowledge-handoff") {
    lead = (
      <>
        {model.handedFrom ? (
          <>
            Taking over from <b className="text-ink-primary">{model.handedFrom}</b>.{" "}
          </>
        ) : null}
        Acknowledging means you now hold clinical responsibility for{" "}
        <b className="text-ink-primary">{first}</b>.
      </>
    );
  } else if (action.kind === "sign-off") {
    lead = <>Signing off confirms the {noun} and hands the case forward.</>;
  } else if (action.kind === "generate") {
    lead = <>The inputs are in — generate the {noun} when you're ready.</>;
  } else {
    // add-records / review-questions / record-interview / record-memo
    lead = <>There's a step to finish before the {noun} is ready.</>;
    cta = `${action.label} →`;
  }

  return (
    <>
      <div className="text-[14px] leading-relaxed text-ink-muted">{lead}</div>
      {pending}
      <button
        type="button"
        onClick={() => onAction(action)}
        className="mt-3 min-h-[52px] w-full rounded-[11px] bg-brand py-3.5 text-[15.5px] font-semibold text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.16)_inset] hover:bg-brand-soft"
      >
        {cta}
      </button>
    </>
  );
}

function SourceLink({
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

function ProviderChain({ chain }: { chain: ChainNode[] }) {
  if (chain.length === 0) return <div />;
  return (
    <div className="flex-none">
      <div className="mb-2.5 flex items-center justify-end gap-1.5 text-[12px] text-ink-subtle">
        <span className="inline-block h-[7px] w-[7px] rounded-full bg-status-supported" />
        Synced just now
      </div>
      <div className="flex items-center">
        {chain.map((p, i) => {
          const cur = p.state === "current";
          return (
            <div key={i} className="flex items-center">
              {i > 0 && <div className="h-px w-[22px] flex-none bg-surface-overlay" />}
              <div
                className={`flex items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-3.5 ${
                  cur ? "border-brand bg-brand" : "border-surface-overlay bg-surface-panel"
                }`}
              >
                <span
                  className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
                    cur ? "bg-white/20 text-ink-onBrand" : "bg-[#DCD3C2] text-ink-secondary"
                  }`}
                >
                  {p.initials}
                </span>
                <span className="text-left">
                  <span
                    className={`block text-[9.5px] font-bold tracking-[.07em] ${
                      cur ? "text-white/80" : "text-ink-subtle"
                    }`}
                  >
                    {p.role}
                  </span>
                  <span
                    className={`block text-[13px] font-semibold ${
                      cur ? "text-ink-onBrand" : "text-ink-body"
                    }`}
                  >
                    {p.name}
                  </span>
                  <span
                    className={`mt-px block text-[10px] ${cur ? "text-white/70" : "text-ink-faint"}`}
                  >
                    {p.meta}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
