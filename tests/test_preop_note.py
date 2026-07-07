"""PreOpNoteWriter + ClaimVerifier tests (spec §3.3 step 5, §4).

The note writer emits atomic claims, each citing record chunks and/or
interview segments. The verifier re-checks each claim against its cited spans
(NLI-style) → supported / unsupported / conflicting. Unsupported claims are
kept but flagged, never dropped (spec §4.3).
"""

import threading

import pytest

from periop.agents.claim_verifier import ClaimVerifier
from periop.agents.preop_note import PreOpNoteWriter, WriterClaim, WriterOutput
from periop.schemas import Case, ClaimStatus, OpenQuestion, SourceType
from periop.tools.chunker import ingest_document
from periop.tools.ingest import transcript_from_script


GP = """\
# GP Summary

## Medications

Aspirin 100mg OD, current.
"""


def _case_with_interview(tmp_path):
    case = Case(case_id="sg-0001")
    case.add_source(ingest_document("doc:gp-summary", GP))
    script = tmp_path / "preop.json"
    script.write_text(
        '{"turns": ['
        '{"speaker": "PROVIDER", "text": "Still on aspirin?"},'
        '{"speaker": "PATIENT", "text": "No, I stopped it six days ago."}'
        ']}'
    )
    case.add_source(transcript_from_script(script, "audio:preop-interview"))
    return case


class FakeChat:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append({"user": user, "schema": schema, "system": system})
        return self.result


class TestPreOpNoteWriter:
    def test_builds_artifact_of_claims(self, tmp_path):
        case = _case_with_interview(tmp_path)
        out = WriterOutput(
            claims=[
                WriterClaim(
                    text="Aspirin was discontinued 6 days before surgery.",
                    section="Medications",
                    provenance=["audio:preop-interview#s002"],
                )
            ]
        )
        writer = PreOpNoteWriter(chat=FakeChat(out))
        artifact = writer.write(case)
        assert artifact.artifact_id == "note:pre-anesthesia-eval"
        assert artifact.claims[0].claim_id == "c-001"
        assert artifact.claims[0].status == ClaimStatus.UNVERIFIED
        # persisted on the case with provenance validated
        assert case.get_artifact("note:pre-anesthesia-eval") is artifact

    def test_prompt_includes_open_questions_for_alignment(self, tmp_path):
        case = _case_with_interview(tmp_path)
        case.open_questions = [OpenQuestion(question="Is the patient still taking aspirin?")]
        writer = PreOpNoteWriter(chat=FakeChat(WriterOutput(claims=[])))
        writer.write(case)
        prompt = writer.chat.calls[0]["user"]
        assert "Is the patient still taking aspirin?" in prompt
        assert "audio:preop-interview#s002" in prompt  # interview cited by anchor

    def test_prompt_uses_reviewed_question_list(self, tmp_path):
        # spec v2 §4.1: the approved list is what question→answer alignment
        # runs against — dismissed questions are excluded, edits win
        case = _case_with_interview(tmp_path)
        case.open_questions = [
            OpenQuestion(question="Dismissed q?", review="dismissed"),
            OpenQuestion(question="Original q?", review="edited", edited_text="Edited q?"),
            OpenQuestion(question="Approved q?", review="approved"),
        ]
        writer = PreOpNoteWriter(chat=FakeChat(WriterOutput(claims=[])))
        writer.write(case)
        prompt = writer.chat.calls[0]["user"]
        assert "Dismissed q?" not in prompt
        assert "Edited q?" in prompt
        assert "Original q?" not in prompt
        assert "Approved q?" in prompt

    def test_bracketed_provenance_refs_are_normalized_and_kept(self, tmp_path):
        # prompts display refs as [source#anchor]; models sometimes echo the
        # brackets — the claim must survive with the clean ref, not be dropped
        case = _case_with_interview(tmp_path)
        out = WriterOutput(
            claims=[
                WriterClaim(text="ok", section="X",
                            provenance=["[doc:gp-summary#c001]", " audio:preop-interview#s002 "]),
            ]
        )
        artifact = PreOpNoteWriter(chat=FakeChat(out)).write(case)
        assert [str(r) for r in artifact.claims[0].provenance] == [
            "doc:gp-summary#c001",
            "audio:preop-interview#s002",
        ]

    def test_drops_claims_with_dangling_provenance(self, tmp_path):
        case = _case_with_interview(tmp_path)
        out = WriterOutput(
            claims=[
                WriterClaim(text="ok", section="X", provenance=["doc:gp-summary#c001"]),
                WriterClaim(text="bad", section="X", provenance=["doc:ghost#c9"]),
            ]
        )
        artifact = PreOpNoteWriter(chat=FakeChat(out)).write(case)
        assert [c.text for c in artifact.claims] == ["ok"]


class VerifierFakeChat:
    """Maps claim-text snippets → verdicts, thread-safely.

    Verification fans out (v2-speed W9c), so call order is no longer claim
    order — verdicts are keyed by the claim text in the prompt instead.
    """

    def __init__(self, by_text):
        self.by_text = dict(by_text)
        self.calls = []
        self._lock = threading.Lock()

    def complete_structured(self, user, schema, system=None, **kwargs):
        with self._lock:
            self.calls.append(user)
        status = next(s for text, s in self.by_text.items() if text in user)
        return schema(status=status, rationale="test")


class TestRelevanceFiltering:
    """Distractor leakage (spec §5/§6): records carry deliberately irrelevant
    history; the writer must exclude it or justify its anesthetic relevance."""

    def test_prompt_carries_relevance_rule_with_examples(self, tmp_path):
        case = _case_with_interview(tmp_path)
        chat = FakeChat(WriterOutput(claims=[]))
        PreOpNoteWriter(chat=chat).write(case)
        prompt = chat.calls[0]["user"]
        assert "Relevance filter" in prompt
        assert "resolved" in prompt and "distractor" in prompt.lower()
        # the justification requirement is what distractor_leakage measures
        assert "state that reason in the claim text" in prompt


class TestClaimVerifier:
    def _artifact_case(self, tmp_path):
        case = _case_with_interview(tmp_path)
        out = WriterOutput(
            claims=[
                WriterClaim(text="Stopped aspirin 6 days ago.", section="Meds",
                            provenance=["audio:preop-interview#s002"]),
                WriterClaim(text="Patient is on aspirin.", section="Meds",
                            provenance=["doc:gp-summary#c001"]),
            ]
        )
        PreOpNoteWriter(chat=FakeChat(out)).write(case)
        return case

    def test_sets_status_from_verifier(self, tmp_path):
        case = self._artifact_case(tmp_path)
        verifier = ClaimVerifier(
            chat=VerifierFakeChat(
                {"Stopped aspirin": "supported", "is on aspirin": "conflicting"}
            )
        )
        verifier.verify(case, "note:pre-anesthesia-eval")
        claims = case.get_artifact("note:pre-anesthesia-eval").claims
        assert claims[0].status == ClaimStatus.SUPPORTED
        assert claims[1].status == ClaimStatus.CONFLICTING

    def test_verifier_sees_cited_span_text(self, tmp_path):
        case = self._artifact_case(tmp_path)
        verifier = ClaimVerifier(
            chat=VerifierFakeChat({"aspirin": "supported"})
        )
        verifier.verify(case, "note:pre-anesthesia-eval")
        assert any(
            "stopped it six days ago" in call.lower() for call in verifier.chat.calls
        )

    def test_forward_looking_mode_offers_inference_verdict(self, tmp_path):
        # Anticipated issues are risk projections: the spans can support the
        # risk factors but never entail the outcome, so entailment-style
        # verification would read them all "unsupported" (progress.md).
        case = self._artifact_case(tmp_path)
        verifier = ClaimVerifier(
            chat=VerifierFakeChat(
                {"Stopped aspirin": "inference", "is on aspirin": "supported"}
            )
        )
        verifier.verify(case, "note:pre-anesthesia-eval", forward_looking=True)
        claims = case.get_artifact("note:pre-anesthesia-eval").claims
        assert claims[0].status == ClaimStatus.INFERENCE
        assert '"inference"' in verifier.chat.calls[0]

    def test_default_mode_does_not_offer_inference(self, tmp_path):
        case = self._artifact_case(tmp_path)
        verifier = ClaimVerifier(chat=VerifierFakeChat({"aspirin": "supported"}))
        verifier.verify(case, "note:pre-anesthesia-eval")
        assert '"inference"' not in verifier.chat.calls[0]

    def test_unsupported_claims_are_kept_not_dropped(self, tmp_path):
        case = self._artifact_case(tmp_path)
        ClaimVerifier(chat=VerifierFakeChat({"aspirin": "unsupported"})).verify(
            case, "note:pre-anesthesia-eval"
        )
        claims = case.get_artifact("note:pre-anesthesia-eval").claims
        assert len(claims) == 2
        assert all(c.status == ClaimStatus.UNSUPPORTED for c in claims)


class TestClaimVerifierFanOut:
    """Bounded parallel verification (spec v2-speed §3.3): independent
    verdicts on distinct Claim objects, ~1.5–2 s per Nano call, served one at
    a time by a `for` loop today. The pool must keep the ledger identical to
    the sequential version and keep every call NAT-traced."""

    def _many_claim_case(self, tmp_path, n=6):
        case = _case_with_interview(tmp_path)
        out = WriterOutput(
            claims=[
                WriterClaim(text=f"Claim number {i}.", section="X",
                            provenance=["doc:gp-summary#c001"])
                for i in range(n)
            ]
        )
        PreOpNoteWriter(chat=FakeChat(out)).write(case)
        return case

    def test_every_claim_gets_a_verdict_and_order_is_unchanged(self, tmp_path):
        case = self._many_claim_case(tmp_path)
        verifier = ClaimVerifier(
            chat=VerifierFakeChat(
                {f"Claim number {i}.": ("supported" if i % 2 else "unsupported")
                 for i in range(6)}
            )
        )
        verifier.verify(case, "note:pre-anesthesia-eval")
        claims = case.get_artifact("note:pre-anesthesia-eval").claims
        assert [c.text for c in claims] == [f"Claim number {i}." for i in range(6)]
        expected = [ClaimStatus.UNSUPPORTED if i % 2 == 0 else ClaimStatus.SUPPORTED
                    for i in range(6)]
        assert [c.status for c in claims] == expected

    def test_calls_actually_overlap_at_default_concurrency(self, tmp_path, monkeypatch):
        # two calls must be in flight at once: each waits at a two-party
        # barrier that a strictly sequential loop could never satisfy
        monkeypatch.delenv("PERIOP_VERIFIER_CONCURRENCY", raising=False)
        case = self._many_claim_case(tmp_path, n=4)
        barrier = threading.Barrier(2, timeout=5)

        class BarrierChat:
            def complete_structured(self, user, schema, system=None, **kwargs):
                barrier.wait()
                return schema(status="supported", rationale="ok")

        ClaimVerifier(chat=BarrierChat()).verify(case, "note:pre-anesthesia-eval")
        claims = case.get_artifact("note:pre-anesthesia-eval").claims
        assert all(c.status == ClaimStatus.SUPPORTED for c in claims)

    def test_concurrency_env_one_stays_sequential(self, tmp_path, monkeypatch):
        monkeypatch.setenv("PERIOP_VERIFIER_CONCURRENCY", "1")
        case = self._many_claim_case(tmp_path, n=3)
        threads = []

        class RecordingChat:
            def complete_structured(self, user, schema, system=None, **kwargs):
                threads.append(threading.current_thread())
                return schema(status="supported", rationale="ok")

        ClaimVerifier(chat=RecordingChat()).verify(case, "note:pre-anesthesia-eval")
        assert threads == [threading.current_thread()] * 3

    def test_one_failing_claim_raises_without_deadlock(self, tmp_path):
        case = self._many_claim_case(tmp_path, n=5)

        class FlakyChat:
            def complete_structured(self, user, schema, system=None, **kwargs):
                if "Claim number 2." in user:
                    raise RuntimeError("verifier NIM unreachable")
                return schema(status="supported", rationale="ok")

        with pytest.raises(RuntimeError, match="unreachable"):
            ClaimVerifier(chat=FlakyChat()).verify(case, "note:pre-anesthesia-eval")

    def test_worker_calls_stay_on_the_nat_step_stream(self, tmp_path):
        """The contextvar-propagation pin (spec §5): a bare ThreadPoolExecutor
        would silently un-trace all 62 verification calls — repeating the
        §1.2 bug at scale. One LLM_START/LLM_END pair per claim must reach a
        stream subscribed in the *calling* context."""
        from types import SimpleNamespace

        from nat.builder.context import ContextState
        from nat.data_models.intermediate_step import IntermediateStepType

        from periop.nim import FAST_MODEL, NimChat

        case = self._many_claim_case(tmp_path, n=6)

        class ThreadSafeCompletions:
            def create(self, **kwargs):
                return SimpleNamespace(
                    choices=[SimpleNamespace(message=SimpleNamespace(
                        content='{"status": "supported", "rationale": "ok"}'
                    ))],
                    usage=None,
                )

        chat = NimChat(
            client=SimpleNamespace(chat=SimpleNamespace(completions=ThreadSafeCompletions())),
            model=FAST_MODEL,
        )
        collected = []
        subscription = ContextState.get().event_stream.get().subscribe(collected.append)
        try:
            ClaimVerifier(chat=chat).verify(case, "note:pre-anesthesia-eval")
        finally:
            subscription.unsubscribe()
        events = [s.payload.event_type for s in collected]
        assert events.count(IntermediateStepType.LLM_START) == 6
        assert events.count(IntermediateStepType.LLM_END) == 6
