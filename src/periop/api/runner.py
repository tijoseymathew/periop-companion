"""Pipeline runner seam for the write API (spec v2 §3).

The workflow endpoints never talk to the NIMs directly: they call an injected
runner so tests (and the hermetic e2e server) can substitute instant stubs.
The live runner constructs the existing chat tiers lazily — importing this
module must not require network or keys.
"""

from __future__ import annotations

import time

from periop.schemas import (
    ArtifactRecord,
    AudioSegment,
    Case,
    Claim,
    ClaimStatus,
    EquipmentSuggestion,
    Event,
    EventCategory,
    OpenQuestion,
    Source,
    SourceType,
)


class LivePipelineRunner:
    """Default runner: the real agents against live NIMs (lazy construction)."""

    def _chats(self):
        from periop.nim import fast_chat, reasoning_chat

        return reasoning_chat(), fast_chat()

    def analyze_gaps(self, case: Case) -> None:
        from periop.agents.gap_analyst import GapAnalyst

        chat, _ = self._chats()
        GapAnalyst(chat=chat).analyze(case)

    def run_stage(self, case: Case, stage: str, case_dir, emit) -> Case:
        from periop.agents.stages import run_intraop_stage, run_postop_stage
        from periop.agents.preop_stage import run_preop_stage

        chat, fast = self._chats()
        if stage == "preop":
            return run_preop_stage(case, case_dir, chat=chat, verifier_chat=fast, emit=emit)
        if stage == "intraop":
            return run_intraop_stage(case, case_dir, chat=chat, fast_chat=fast, emit=emit)
        return run_postop_stage(case, case_dir, chat=chat, fast_chat=fast, emit=emit)

    def transcribe(self, wav_path, kind: str, source_id: str) -> Source:
        """Batch-ASR one uploaded recording (upload-time transcription).

        Same Parakeet configuration as the stage pipeline's Transcriber:
        diarized for interviews, single-speaker with the anesthesia lexicon
        boosted for intra-op memos.
        """
        import periop.tools.asr as asr_mod
        from periop.agents.lexicon import ANESTHESIA_LEXICON

        intraop = kind == "intraop-notes"
        asr = asr_mod.ParakeetAsr(boosted_words=ANESTHESIA_LEXICON if intraop else None)
        return asr.transcribe(wav_path, source_id, diarize=not intraop)


class FakeStreamingTranscriber:
    """Deterministic dictation double for hermetic e2e (``PERIOP_STUB_RUNNER=1``).

    Emits one partial per audio frame and one canned final at stop, matching
    the stub intra-op artifact's provenance text, so the streamed segment is
    what the generated record cites.
    """

    PARTIAL = "Propofol one twenty…"
    FINAL = "[08:02] Propofol one twenty milligrams."

    def feed(self, pcm: bytes) -> list[dict]:
        return [{"type": "partial", "text": self.PARTIAL}]

    def finish(self) -> list[dict]:
        return [{"type": "final", "text": self.FINAL}]


class StubChatRuntime:
    """Deterministic case-chat double for hermetic e2e (``PERIOP_STUB_RUNNER=1``).

    Same surface as ``periop.agents.case_chat.CaseChatRuntime`` (``history`` /
    ``send``) with scripted behavior: a message that asks to reserve or order
    reserves one 7.0 ETT through the *real* equipment ledger (so the stock
    view shows the assignment), anything else answers with the case's first
    matching passage via the real search helper.
    """

    STUB_ITEM = "ett-7.0"

    def __init__(self, out_dir) -> None:
        from periop.equipment import EquipmentStore

        self.out_dir = out_dir
        self.equipment = EquipmentStore(out_dir)
        self._history: dict[str, list[dict]] = {}

    def history(self, case_id: str) -> list[dict]:
        return list(self._history.get(case_id, []))

    def send(self, case_id: str, message: str, provider_id: str, emit) -> str:
        from periop.agents.case_chat import search_case_texts
        from periop.equipment import CATALOG_BY_ID
        from periop.store import CaseStore

        turns = self._history.setdefault(case_id, [])
        turns.append({"role": "user", "text": message})

        lowered = message.lower()
        if "reserve" in lowered or "order" in lowered:
            emit("tool_call", {"name": "reserve_equipment",
                               "args": {"item_id": self.STUB_ITEM, "quantity": 1}})
            try:
                self.equipment.reserve(self.STUB_ITEM, case_id, 1, provider_id)
                name = CATALOG_BY_ID[self.STUB_ITEM].name
                reply = f"Reserved 1 × {name} for this case."
                emit("tool_result", {"name": "reserve_equipment",
                                     "result": {"reserved": {"item_id": self.STUB_ITEM}}})
            except ValueError as exc:
                reply = f"Could not reserve: {exc}"
                emit("tool_result", {"name": "reserve_equipment", "result": {"error": str(exc)}})
        else:
            emit("tool_call", {"name": "search_case", "args": {"query": message}})
            case = CaseStore(self.out_dir).load(case_id)
            hits = search_case_texts(case, message)
            emit("tool_result", {"name": "search_case", "result": {"results": hits}})
            reply = (
                f"The record says: “{hits[0]['text']}” ({hits[0]['ref']})"
                if hits
                else "I couldn't find anything about that in this case's record."
            )

        turns.append({"role": "assistant", "text": reply})
        return reply


class StubPipelineRunner:
    """Instant deterministic runner for hermetic e2e (``PERIOP_STUB_RUNNER=1``).

    Fabricated artifacts cite real chunks and segments registered on the case
    so every provenance interaction in the review UI — chip clicks, reverse
    index, clip playback offsets — behaves exactly as with live output. Never
    used outside tests/e2e; the env flag is the only way in.
    """

    #: pause between progress events so the e2e can watch the SSE rendering
    EVENT_DELAY_S = 0.25

    def analyze_gaps(self, case: Case) -> None:
        doc = next(s for s in case.sources if s.type is SourceType.DOCUMENT)
        ref = f"{doc.source_id}#{doc.chunks[0].chunk_id}"
        case.open_questions = [
            OpenQuestion(
                question="Is the patient still taking aspirin?",
                reason="conflicting",
                provenance=[ref],
            )
        ]

    def _emit(self, emit, event: str, data: dict) -> None:
        time.sleep(self.EVENT_DELAY_S)
        emit(event, data)

    def _interview_source(self, source_id: str) -> Source:
        return Source(
            source_id=source_id,
            type=SourceType.AUDIO,
            segments=[
                AudioSegment(
                    seg_id="s001", t0=0.0, t1=1.5, speaker="PROVIDER",
                    text="Any blood thinners at the moment?",
                ),
                AudioSegment(
                    seg_id="s002", t0=1.5, t1=3.0, speaker="PATIENT",
                    text="I stopped the aspirin last Tuesday.",
                ),
            ],
        )

    def _intraop_source(self, source_id: str) -> Source:
        return Source(
            source_id=source_id,
            type=SourceType.AUDIO,
            segments=[
                AudioSegment(
                    seg_id="s001", t0=0.0, t1=2.0, speaker="PROVIDER",
                    text="[08:02] Propofol one twenty milligrams.",
                ),
                AudioSegment(
                    seg_id="s002", t0=2.0, t1=4.0, speaker="PROVIDER",
                    text="[08:04] Tube in, size seven, sevo running.",
                ),
                AudioSegment(
                    seg_id="s003", t0=4.0, t1=6.0, speaker="PROVIDER",
                    text="[08:41] Gallbladder out, hemostasis looks good.",
                ),
            ],
        )

    def transcribe(self, wav_path, kind: str, source_id: str) -> Source:
        """Instant canned transcript, matching what run_stage would register."""
        if kind == "intraop-notes":
            return self._intraop_source(source_id)
        return self._interview_source(source_id)

    def run_stage(self, case: Case, stage: str, case_dir, emit) -> Case:
        doc = next(s for s in case.sources if s.type is SourceType.DOCUMENT)
        doc_ref = f"{doc.source_id}#{doc.chunks[0].chunk_id}"

        if stage == "preop":
            if case.get_source("audio:preop-interview") is None:
                case.add_source(self._interview_source("audio:preop-interview"))
            self._emit(emit, "agent_start", {"stage": stage, "agent": "PreOpNoteWriter"})
            case.add_artifact(
                ArtifactRecord(
                    artifact_id="note:pre-anesthesia-eval",
                    claims=[
                        Claim(
                            claim_id="c-001",
                            text="Aspirin was stopped six days before surgery.",
                            provenance=["audio:preop-interview#s002"],
                            status=ClaimStatus.SUPPORTED,
                        ),
                        Claim(
                            claim_id="c-002",
                            text="Records still list aspirin as current.",
                            provenance=[doc_ref],
                            status=ClaimStatus.CONFLICTING,
                        ),
                        Claim(
                            claim_id="c-003",
                            text="Hypertension, controlled on amlodipine.",
                            provenance=[doc_ref],
                            status=ClaimStatus.SUPPORTED,
                        ),
                        Claim(
                            claim_id="c-004",
                            text="Aspirin was started after a TIA in 2019.",
                            provenance=[doc_ref],
                            status=ClaimStatus.SUPPORTED,
                        ),
                        Claim(
                            claim_id="c-005",
                            text="No known drug allergies.",
                            provenance=[doc_ref],
                            status=ClaimStatus.SUPPORTED,
                        ),
                    ],
                )
            )
            case.equipment_suggestions = [
                EquipmentSuggestion(
                    item_id="ett-7.0",
                    name="Endotracheal tube 7.0 mm",
                    reason="GA with intubation planned",
                ),
                EquipmentSuggestion(
                    item_id="bougie",
                    name="Tracheal tube introducer (bougie)",
                    reason="Backup for first-pass intubation",
                ),
            ]
            self._emit(
                emit, "agent_end",
                {
                    "stage": stage, "agent": "PreOpNoteWriter", "summary": "5 claims",
                    "preview": [
                        "Aspirin was stopped six days before surgery.",
                        "Records still list aspirin as current.",
                    ],
                },
            )
            self._emit(
                emit, "artifact_complete",
                {"artifact_id": "note:pre-anesthesia-eval", "claims": 5},
            )
            return case

        if stage == "intraop":
            if case.get_source("audio:intraop-notes") is None:
                case.add_source(self._intraop_source("audio:intraop-notes"))
            self._emit(emit, "agent_start", {"stage": stage, "agent": "EventExtractor"})
            case.intraop_events = [
                Event(
                    t="08:02", category=EventCategory.DOSE, value="Propofol 120",
                    units="mg", provenance=["audio:intraop-notes#s001"],
                ),
                Event(
                    t="08:04", category=EventCategory.AIRWAY,
                    value="Intubated, ETT 7.0; sevoflurane maintenance",
                    provenance=["audio:intraop-notes#s002"],
                ),
                Event(
                    t="08:41", category=EventCategory.EVENT,
                    value="Gallbladder out; hemostasis confirmed",
                    provenance=["audio:intraop-notes#s003"],
                ),
            ]
            case.add_artifact(
                ArtifactRecord(
                    artifact_id="record:intra-op",
                    claims=[
                        Claim(
                            claim_id="c-001",
                            text="Propofol 120 mg given at 08:02.",
                            provenance=["audio:intraop-notes#s001"],
                            status=ClaimStatus.SUPPORTED,
                        ),
                        Claim(
                            claim_id="c-002",
                            text="Intubated with a 7.0 ETT; maintained on sevoflurane.",
                            provenance=["audio:intraop-notes#s002"],
                            status=ClaimStatus.SUPPORTED,
                        ),
                        Claim(
                            claim_id="c-003",
                            text="Gallbladder removed at 08:41 with good hemostasis.",
                            provenance=["audio:intraop-notes#s003"],
                            status=ClaimStatus.SUPPORTED,
                        ),
                    ],
                )
            )
            case.anticipated_issues = [
                "Restarting aspirin — confirm the plan with the surgical team.",
                "Day-case discharge: needs a responsible adult escort tonight.",
            ]
            self._emit(
                emit, "agent_end",
                {
                    "stage": stage, "agent": "EventExtractor", "summary": "3 events",
                    "preview": [
                        "08:02 [dose] Propofol 120 mg",
                        "08:04 [airway] Intubated, ETT 7.0",
                        "08:41 [event] Gallbladder out",
                    ],
                },
            )
            self._emit(emit, "artifact_complete", {"artifact_id": "record:intra-op", "claims": 3})
            return case

        # postop: handoff inherits pre-op/intra-op provenance (no-new-claims
        # constraint), so both cited sources must exist even on a lone run
        if case.get_source("audio:postop-interview") is None:
            case.add_source(self._interview_source("audio:postop-interview"))
        if case.get_source("audio:intraop-notes") is None:
            case.add_source(self._intraop_source("audio:intraop-notes"))
        if case.get_source("audio:preop-interview") is None:
            case.add_source(self._interview_source("audio:preop-interview"))
        self._emit(emit, "agent_start", {"stage": stage, "agent": "HandoffComposer"})
        case.add_artifact(
            ArtifactRecord(
                artifact_id="note:pacu-handoff",
                claims=[
                    Claim(
                        claim_id="c-001",
                        text="Aspirin held pre-op; restart per surgical team.",
                        provenance=["audio:preop-interview#s002"],
                        status=ClaimStatus.SUPPORTED,
                    ),
                    Claim(
                        claim_id="c-002",
                        text="Uncomplicated laparoscopic cholecystectomy under GA.",
                        provenance=["audio:intraop-notes#s003"],
                        status=ClaimStatus.SUPPORTED,
                    ),
                    Claim(
                        claim_id="c-003",
                        text="No known drug allergies.",
                        provenance=[doc_ref],
                        status=ClaimStatus.SUPPORTED,
                    ),
                ],
            )
        )
        self._emit(emit, "artifact_complete", {"artifact_id": "note:pacu-handoff", "claims": 3})
        case.add_artifact(
            ArtifactRecord(
                artifact_id="note:post-anesthesia-eval",
                claims=[
                    Claim(
                        claim_id="c-001",
                        text="No pain or nausea reported in recovery.",
                        provenance=["audio:postop-interview#s002"],
                        status=ClaimStatus.SUPPORTED,
                    ),
                    Claim(
                        claim_id="c-002",
                        text="Airway was uncomplicated; extubated awake.",
                        provenance=["audio:intraop-notes#s002"],
                        status=ClaimStatus.SUPPORTED,
                    ),
                ],
            )
        )
        self._emit(
            emit, "agent_end",
            {
                "stage": stage, "agent": "HandoffComposer", "summary": "composed",
                "preview": [
                    "Aspirin held pre-op; restart per surgical team.",
                    "No pain or nausea reported in recovery.",
                ],
            },
        )
        self._emit(
            emit, "artifact_complete",
            {"artifact_id": "note:post-anesthesia-eval", "claims": 2},
        )
        return case
