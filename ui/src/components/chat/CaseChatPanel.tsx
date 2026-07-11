/**
 * Case assistant: a floating chat over the case view. Answers come from the
 * case's own records via the backend agent's search/read tools; during
 * pre-op it can also order anaesthesia equipment for the case. Tool activity
 * streams in as small status rows so the provider sees *how* an answer was
 * found (which search, which document, which reservation), echoing the
 * provenance-first posture of the rest of the UI.
 */
import { useEffect, useRef, useState } from "react";
import { fetchChatHistory } from "../../lib/api";
import { streamChatTurn, type RunEvent } from "../../lib/sse";

interface Turn {
  kind: "user" | "assistant" | "tool" | "error";
  text: string;
}

/** One human line per tool call the agent makes. */
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "search_case":
      return `Searching the record for “${String(args.query ?? "")}”`;
    case "read_source":
      return `Reading ${String(args.source_id ?? "a source")}`;
    case "list_sources":
      return "Listing the case's records";
    case "list_equipment":
      return "Checking the equipment store";
    case "reserve_equipment":
      return `Reserving ${String(args.quantity ?? "")} × ${String(args.item_id ?? "")}`;
    case "release_equipment":
      return `Returning ${String(args.item_id ?? "")}`;
    case "case_equipment":
      return "Checking this case's equipment";
    default:
      return `${name}…`;
  }
}

export function CaseChatPanel({ caseId, me }: { caseId: string; me: string | null }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // earlier turns survive a reopen (and, server-side, a case switch)
  useEffect(() => {
    if (!open || loaded) return;
    fetchChatHistory(caseId)
      .then((history) =>
        setTurns(history.map((m) => ({ kind: m.role, text: m.text }))),
      )
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [open, loaded, caseId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  async function send() {
    const message = draft.trim();
    if (!message || !me || busy) return;
    setDraft("");
    setBusy(true);
    setTurns((prev) => [...prev, { kind: "user", text: message }]);
    try {
      const reply = await streamChatTurn(caseId, message, me, (ev: RunEvent) => {
        if (ev.event === "tool_call") {
          const line = describeToolCall(
            String(ev.data.name ?? ""),
            (ev.data.args as Record<string, unknown>) ?? {},
          );
          setTurns((prev) => [...prev, { kind: "tool", text: line }]);
        }
      });
      setTurns((prev) => [
        ...prev,
        { kind: "assistant", text: reply || "(no answer)" },
      ]);
    } catch (e) {
      setTurns((prev) => [
        ...prev,
        { kind: "error", text: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-brand px-5 py-3 text-[14px] font-semibold text-ink-onBrand shadow-[0_6px_20px_rgba(35,27,15,.25)] hover:bg-brand-soft"
      >
        <span aria-hidden>✳</span> Ask about this case
      </button>
    );
  }

  return (
    <div
      data-testid="case-chat-panel"
      className="fixed bottom-6 right-6 z-40 flex h-[560px] max-h-[80vh] w-[400px] flex-col overflow-hidden rounded-2xl border border-surface-overlay bg-surface-base shadow-[0_12px_40px_rgba(35,27,15,.3)]"
    >
      <div className="flex flex-none items-start justify-between gap-3 border-b border-surface-chromeline bg-surface-chrome px-4 py-3">
        <div>
          <div className="text-[14px] font-semibold text-ink-primary">Case assistant</div>
          <div className="mt-0.5 text-[11.5px] text-ink-dim">
            Answers from this case's records · orders equipment during pre-op
          </div>
        </div>
        <button
          type="button"
          aria-label="Close assistant"
          onClick={() => setOpen(false)}
          className="rounded px-1.5 text-[16px] text-ink-dim hover:text-ink-primary"
        >
          ×
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        {turns.length === 0 && !busy && (
          <p className="pt-6 text-center text-[13px] leading-relaxed text-ink-subtle">
            Ask anything answerable from this case's documents and transcripts —
            “Is she still on aspirin?”, “What did the GP letter say about
            allergies?” — or order equipment: “Reserve a video laryngoscope.”
          </p>
        )}
        {turns.map((t, i) => {
          if (t.kind === "tool") {
            return (
              <div key={i} className="flex items-center gap-1.5 px-1 text-[11.5px] text-ink-subtle">
                <span aria-hidden>⚙</span> {t.text}
              </div>
            );
          }
          if (t.kind === "error") {
            return (
              <div
                key={i}
                className="rounded-lg border border-status-conflicting/50 bg-status-conflicting/10 px-3 py-2 text-[13px] text-status-conflicting"
              >
                {t.text}
              </div>
            );
          }
          const mine = t.kind === "user";
          return (
            <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed ${
                  mine
                    ? "rounded-br-md bg-brand text-ink-onBrand"
                    : "rounded-bl-md bg-surface-panel text-ink-body"
                }`}
              >
                {t.text}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 px-1 text-[12px] text-ink-dim">
            <span
              className="h-3 w-3 flex-none rounded-full border-2 border-transparent border-t-brand"
              style={{ animation: "spin .8s linear infinite" }}
            />
            Thinking…
          </div>
        )}
      </div>

      <form
        className="flex flex-none items-end gap-2 border-t border-surface-line px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!me || busy}
          placeholder={me ? "Ask about this case…" : "Pick a provider to chat"}
          className="min-h-[40px] w-full rounded-[10px] border border-surface-overlay bg-surface-sunken px-3 text-[13.5px] text-ink-primary outline-none placeholder:text-ink-ghost focus:border-brand"
        />
        <button
          type="submit"
          disabled={!me || busy || !draft.trim()}
          className="flex min-h-[40px] flex-none items-center rounded-[10px] bg-brand px-4 text-[13.5px] font-semibold text-ink-onBrand disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
