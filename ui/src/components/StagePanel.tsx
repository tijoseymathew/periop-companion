/**
 * The center-pane capture screen for a live case's stage before its
 * artifacts exist (spec v2 §6). Dispatches on the one primary action: every
 * screen opens with one plain sentence and exactly one dominant button, and
 * failures say what to do next.
 */
import { useState } from "react";
import { addDocumentText, reviewQuestions, uploadDocumentFile } from "../lib/api";
import type { Case, OpenQuestion } from "../lib/schema";
import { STATUS_WORDS, type PrimaryAction } from "../lib/workflow";
import { IntakeForm } from "./IntakeForm";
import { QuestionReview } from "./QuestionReview";

export function StagePanel({
  kase,
  me,
  stage,
  action,
  onCaseUpdated,
  onActivateRef,
}: {
  kase: Case;
  me: string | null;
  /** the stage the provider is looking at (the rail selection) */
  stage: "preop" | "intraop" | "postop";
  /** the case's one primary action, when it belongs to this stage */
  action: PrimaryAction | null;
  onCaseUpdated: (updated: Case) => void;
  onActivateRef: (ref: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function guard<T>(work: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await work();
    } catch (e) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        String(e);
      setError(`${detail} — nothing was lost; fix the issue and try again.`);
      return undefined;
    }
  }

  const body = (() => {
    switch (action?.kind) {
      case "add-records":
        return (
          <IntakeForm
            providerId={me}
            existingDocTypes={kase.sources
              .filter((s) => s.type === "document")
              .map((s) => s.source_id.replace(/^doc:/, ""))}
            onAddText={async (docType, text) => {
              if (!me) return;
              const updated = await guard(() =>
                addDocumentText(kase.case_id, docType, text, me),
              );
              if (updated) onCaseUpdated(updated);
            }}
            onUploadFile={async (docType, file) => {
              if (!me) return;
              const updated = await guard(() =>
                uploadDocumentFile(kase.case_id, docType, file, me),
              );
              if (updated) onCaseUpdated(updated);
            }}
          />
        );
      case "review-questions":
        return (
          <QuestionReview
            questions={kase.open_questions}
            onActivateRef={onActivateRef}
            onApprove={async (reviewed: OpenQuestion[]) => {
              if (!me) return;
              const updated = await guard(() =>
                reviewQuestions(kase.case_id, reviewed, me),
              );
              if (updated) onCaseUpdated(updated);
            }}
          />
        );
      default:
        return (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-sm text-ink-secondary">
              This stage is{" "}
              {kase.workflow ? STATUS_WORDS[kase.workflow.stages[stage].status] : "read-only"}.
            </p>
          </div>
        );
    }
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {error && (
        <p className="mx-6 mt-4 rounded border border-status-conflicting/50 p-3 text-sm text-status-conflicting">
          {error}
        </p>
      )}
      {body}
    </div>
  );
}
