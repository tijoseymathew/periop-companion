/**
 * The patient view (PeriOp Catch-Up.dc.html "BRIEF"), generalised so its shape
 * holds at every stage of a case — pre-op, in theatre, recovery, and complete.
 * A clinician reads it top-to-bottom in about a minute: story → key facts (each
 * with a verification badge and a jump to its source) → theatre timeline →
 * anticipated issues, with a "needs you now" rail. The one forward action in the
 * rail adapts to the case's stage (sign off / acknowledge / continue).
 */
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
  onReviewNeed,
  generating = null,
}: {
  model: BriefModel;
  queue: QueueNav | null;
  canReview: boolean;
  onBack: () => void;
  onOpenSource: (req: SourceRequest) => void;
  onAction: (action: PrimaryAction) => void;
  onReviewNeed: (key: number, reviewed: boolean) => void;
  /** non-null while this session's own stage run is streaming — the brief
   * has no FlowChrome to fold the live status into, so it shows minimally
   * in the action panel instead of taking over the screen */
  generating?: string | null;
}) {
  const first = model.title.split(" ")[0] || "this patient";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* header */}
      <div className="flex-none border-b border-surface-chromeline bg-surface-chrome px-8 pb-4 pt-5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3.5">
              <button
                type="button"
                onClick={onBack}
                className="text-[13px] font-semibold text-ink-dim hover:text-ink-primary"
              >
                ‹ Worklist
              </button>
              {queue && queue.total > 1 && (
                <div className="flex items-center gap-0.5">
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
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3.5">
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
        <StageStepper steps={model.stageSteps} />
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        {/* main column */}
        <div className="min-w-0 flex-1 overflow-y-auto px-8 pb-12 pt-6">
          <Eyebrow>The story so far</Eyebrow>
          <div className="mt-0.5 text-[12.5px] text-ink-faint">{model.assembledFrom}</div>
          {model.attentionCount > 0 && (
            <div className="mb-8 mt-3 max-w-[760px]">
              <p className="font-serif text-[19px] leading-relaxed text-ink-body">
                {model.attentionCount === 1
                  ? "One thing is worth your attention"
                  : `${model.attentionCount} things are worth your attention`}{" "}
                before you take over {first}:
              </p>
              <ul className="mt-3 space-y-1.5">
                {model.attentionItems.map((it, i) => (
                  <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-ink-body">
                    <span className="flex-none text-gold">◆</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {model.attentionCount === 0 && <div className="mb-8" />}

          {/* key facts */}
          <div className="flex items-baseline justify-between gap-4">
            <Eyebrow>Key facts</Eyebrow>
            <div className="text-[12.5px] text-ink-faint">
              Open a source to see the original, highlighted
            </div>
          </div>
          <div className="mb-9 mt-1.5">
            {model.keyFacts.map((f) => (
              <div key={f.claimId} className="border-t border-surface-line px-3 py-3.5">
                <div className="flex items-baseline justify-between gap-5">
                  <span className="flex-1 text-[16.5px] leading-snug text-ink-primary">
                    {f.text}
                  </span>
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
            {model.keyFacts.length === 0 && (
              <p className="border-t border-surface-line py-6 text-[14px] text-ink-subtle">
                No facts have been extracted for this case yet.
              </p>
            )}
          </div>

          {/* theatre timeline + anticipated issues aren't reached yet at
              pre-op — the pre-op brief is story + key facts only */}
          {model.stage !== "preop" && (
            <>
              <Eyebrow>
                In theatre{model.intraopPerformer ? ` · ${model.intraopPerformer}` : ""}
              </Eyebrow>
              {model.events.length > 0 ? (
                <>
                  <div className="mb-9 mt-3.5">
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
                </>
              ) : (
                <SectionPlaceholder>
                  {model.reachedTheatre
                    ? "No dictation was recorded for the theatre record."
                    : "Not in the operating room yet — the theatre timeline fills in live once the case reaches theatre."}
                </SectionPlaceholder>
              )}

              <Eyebrow>Anticipated issues</Eyebrow>
              {model.issues.length > 0 ? (
                <div className="mt-3 flex max-w-[760px] flex-col gap-2.5">
                  {model.issues.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-[11px] border border-surface-overlay bg-surface-warm px-4 py-3.5"
                    >
                      <span className="flex-none text-[13px] leading-relaxed text-gold">◆</span>
                      <span className="text-[15px] leading-relaxed text-ink-body">{r}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <SectionPlaceholder>
                  {model.reachedTheatre
                    ? "No post-op issues were anticipated for this case."
                    : "Anticipated post-op issues appear once the theatre record is generated."}
                </SectionPlaceholder>
              )}
            </>
          )}
        </div>

        {/* right rail */}
        <div className="flex w-[410px] flex-none flex-col border-l border-surface-chromeline bg-surface-sunken">
          {/* the pre-op brief skips "needs you now" — those open questions
              were already reviewed in the interview step (the generation
              gate requires it), so re-listing them here is pure clutter */}
          {model.stage !== "preop" && (
            <>
              <div className="flex flex-none items-center gap-2.5 px-6 pb-3 pt-5">
                <span className="text-[12px] font-bold uppercase tracking-[.12em] text-status-conflicting">
                  Needs you now
                </span>
                {model.pendingReview > 0 && (
                  <span className="rounded-full bg-status-conflicting px-2 py-0.5 text-[11.5px] font-bold text-ink-onBrand">
                    {model.pendingReview}
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-3">
                {model.needs.map((n) => (
                  <div
                    key={n.key}
                    className={`mb-3 rounded-[14px] border ${n.reason.borderClass} ${n.reason.bgClass} p-4`}
                    style={{ opacity: n.reviewed ? 0.6 : 1 }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.09em] ${n.reason.textClass}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${n.reason.dotClass}`} />
                        {n.reason.label}
                      </span>
                      {n.reviewed && (
                        <span className="text-[11.5px] font-semibold text-status-supported">
                          ✓ Reviewed
                        </span>
                      )}
                    </div>
                    <div className="text-[15px] font-semibold leading-snug text-ink-primary">
                      {n.title}
                    </div>
                    {n.detail && (
                      <div className="mt-1.5 text-[13.5px] leading-relaxed text-ink-secondary">
                        {n.detail}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-4">
                      {canReview &&
                        (n.reviewed ? (
                          <button
                            type="button"
                            onClick={() => onReviewNeed(n.key, false)}
                            className="text-[12.5px] text-ink-subtle underline"
                          >
                            Undo
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onReviewNeed(n.key, true)}
                            className={`min-h-[40px] rounded-[9px] border bg-surface-base px-3.5 py-2 text-[13px] font-semibold ${n.reason.borderClass} ${n.reason.textClass}`}
                          >
                            Mark reviewed
                          </button>
                        ))}
                      {n.hasProv && (
                        <SourceLink onClick={() => onOpenSource({ title: n.title, refs: n.refs })}>
                          See the sources
                        </SourceLink>
                      )}
                    </div>
                  </div>
                ))}
                {model.needs.length === 0 && (
                  <p className="rounded-[14px] border border-surface-overlay bg-surface-base p-4 text-[13.5px] text-ink-secondary">
                    Nothing outstanding — no open questions on this case.
                  </p>
                )}
              </div>
            </>
          )}
          {model.stage === "preop" && <div className="flex-1" />}

          {/* the one forward action — adapts to the case's stage */}
          <div className="flex-none border-t border-surface-overlay bg-surface-sunken px-6 pb-5 pt-4">
            <div className="rounded-[15px] border border-surface-overlay bg-surface-base p-4">
              <ActionPanel
                model={model}
                canReview={canReview}
                generating={generating}
                first={first}
                onAction={onAction}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact Pre-op › Intra-op › Post-op progress, mirroring FlowChrome's
 * stepper — the brief has its own header and never rendered inside
 * FlowChrome, so without this the stage progress disappeared entirely
 * once a case left the capture flow. */
function StageStepper({ steps }: { steps: BriefModel["stageSteps"] }) {
  return (
    <div className="mt-3 flex items-center gap-1.5">
      {steps.map((s, i) => {
        const done = s.state === "done";
        const current = s.state === "current";
        return (
          <div key={s.key} className="flex items-center">
            {i > 0 && <div className="mx-1.5 h-px w-5 bg-surface-overlay" />}
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
